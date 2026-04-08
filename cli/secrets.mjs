/**
 * Per-device encrypted secrets vault.
 *
 * Encryption: AES-256-GCM via Node's built-in crypto module (zero deps).
 * Master key: a 32-byte random file at ~/.daemon/master.key, mode 600,
 * generated on first run if absent.
 *
 * Threat model:
 *
 *   - An attacker who only has store.db cannot read secrets without
 *     also having master.key.
 *   - An attacker who has root on the device has both. This vault
 *     does not defend against root.
 *   - The relay never sees plaintext secrets — secrets live only on
 *     the device, behind the daemon-device.service user.
 *
 * v1 limitations (intentional):
 *   - No password-derived key. Master key is a flat file. v1.5 adds
 *     password-unlock via Argon2id.
 *   - No multi-device sync of secrets yet. Secrets live only on the
 *     device they were set on. v1.5 adds gossip with the master key
 *     wrapped to each device's pubkey.
 *   - No recovery phrase. Lose master.key = lose secrets. v1.5 adds
 *     BIP-39 recovery (architecture critic finding M-6).
 *
 * The agent calls these via the memory.* / chat.* style WS handlers
 * exposed in cli/daemon.mjs:
 *
 *   secrets.set(name, value, category?, description?)
 *   secrets.get(name)            → decrypted value (DEVICE-INTERNAL ONLY)
 *   secrets.delete(name)
 *   secrets.list()               → names + metadata, NEVER values
 *   secrets.exists(name)         → boolean
 *
 * The relay calls secrets.get over WS only when fetching the value
 * for an inbound get_secret() agent tool call. The value flies over
 * the WS to the relay's per-tenant agent worker and is NEVER persisted
 * by the relay process.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'
import { join } from 'path'
import { userInfo } from 'os'
import { getStore } from './store.mjs'

const STORE_DIR = join(userInfo().homedir, '.daemon')
const MASTER_KEY_PATH = join(STORE_DIR, 'master.key')

let _masterKey = null

function ensureMasterKey() {
  if (_masterKey) return _masterKey
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 })

  if (existsSync(MASTER_KEY_PATH)) {
    _masterKey = readFileSync(MASTER_KEY_PATH)
    if (_masterKey.length !== 32) {
      throw new Error(`master.key has wrong length: ${_masterKey.length} (expected 32)`)
    }
  } else {
    _masterKey = randomBytes(32)
    writeFileSync(MASTER_KEY_PATH, _masterKey)
    try { chmodSync(MASTER_KEY_PATH, 0o600) } catch {}
    console.log('[secrets] generated new master key at', MASTER_KEY_PATH)
  }
  return _masterKey
}

// ── Encryption primitives (AES-256-GCM) ────────────────────

function encrypt(plaintext) {
  const key = ensureMasterKey()
  const nonce = randomBytes(12)  // 96-bit nonce for GCM
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Concatenate ciphertext + authTag (16 bytes) so we can store as one blob
  return {
    ciphertext: Buffer.concat([enc, authTag]).toString('base64'),
    nonce: nonce.toString('base64'),
  }
}

function decrypt(ciphertextB64, nonceB64) {
  const key = ensureMasterKey()
  const nonce = Buffer.from(nonceB64, 'base64')
  const blob = Buffer.from(ciphertextB64, 'base64')
  const authTag = blob.slice(blob.length - 16)
  const enc = blob.slice(0, blob.length - 16)
  const decipher = createDecipheriv('aes-256-gcm', key, nonce)
  decipher.setAuthTag(authTag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}

// ── Public API ─────────────────────────────────────────────

/**
 * Store a secret. Idempotent — same name overwrites in place and
 * resets use_count to 0.
 */
export function setSecret(name, value, opts = {}) {
  if (!name || typeof name !== 'string') throw new Error('name required')
  if (typeof value !== 'string') throw new Error('value must be a string')
  if (name.length > 128) throw new Error('name too long (max 128)')
  if (value.length > 16_384) throw new Error('value too long (max 16384 bytes)')

  const { ciphertext, nonce } = encrypt(value)
  const db = getStore()
  db.prepare(
    `INSERT INTO secrets (name, ciphertext, nonce, algo, category, description, updated_at, use_count)
     VALUES (?, ?, ?, 'aes-256-gcm', ?, ?, datetime('now'), 0)
     ON CONFLICT(name) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       nonce = excluded.nonce,
       category = COALESCE(excluded.category, secrets.category),
       description = COALESCE(excluded.description, secrets.description),
       updated_at = datetime('now'),
       use_count = 0`,
  ).run(
    name,
    ciphertext,
    nonce,
    opts.category || null,
    opts.description || null,
  )
  return { ok: true, name }
}

/**
 * Retrieve a secret by name. Returns the decrypted value as a string,
 * or null if not found. Touches the use stats (last_used_at, use_count++).
 *
 * THIS RETURNS PLAINTEXT. Only call from inside the device daemon process,
 * inside an agent tool execution context, never log the result.
 */
export function getSecret(name) {
  if (!name || typeof name !== 'string') return null
  const db = getStore()
  const row = db.prepare(
    'SELECT ciphertext, nonce FROM secrets WHERE name = ?',
  ).get(name)
  if (!row) return null

  let value
  try {
    value = decrypt(row.ciphertext, row.nonce)
  } catch (e) {
    console.error(`[secrets] failed to decrypt ${name}:`, e.message)
    return null
  }

  // Touch use stats (best-effort, non-blocking)
  try {
    db.prepare(
      `UPDATE secrets SET last_used_at = datetime('now'), use_count = use_count + 1 WHERE name = ?`,
    ).run(name)
  } catch {}
  return value
}

/**
 * Delete a secret. Returns true if it existed, false otherwise.
 */
export function deleteSecret(name) {
  const db = getStore()
  const result = db.prepare('DELETE FROM secrets WHERE name = ?').run(name)
  return result.changes > 0
}

/**
 * List all secrets — names + metadata only, NEVER values. Safe to send
 * to the agent loop and into the system prompt.
 */
export function listSecrets() {
  const db = getStore()
  const rows = db.prepare(
    `SELECT name, category, description, created_at, updated_at,
            last_used_at, use_count
     FROM secrets ORDER BY name`,
  ).all()
  return rows
}

export function existsSecret(name) {
  const db = getStore()
  const row = db.prepare('SELECT 1 FROM secrets WHERE name = ?').get(name)
  return !!row
}

/**
 * Returns true if the master key file exists (vault is initialized).
 * Used by the system-prompt scaffolding to surface "vault: ready" vs
 * "vault: not yet initialized".
 */
export function isVaultInitialized() {
  return existsSync(MASTER_KEY_PATH)
}

export function getMasterKeyPath() {
  return MASTER_KEY_PATH
}
