/**
 * Input sanitization utilities for daemon API routes.
 * All external input should pass through these before use.
 */

const TOKEN_REGEX = /^[a-f0-9]{64}$/

/**
 * Validate and sanitize a session/device token.
 * Must be exactly 64 lowercase hex characters.
 * Returns the token if valid, null if not.
 */
export function sanitizeToken(token: string): string | null {
  if (typeof token !== 'string') return null
  const trimmed = token.trim().toLowerCase()
  if (!TOKEN_REGEX.test(trimmed)) return null
  return trimmed
}

const MAX_COMMAND_LENGTH = 10_000 // 10K chars

/**
 * Sanitize a command string.
 * Strips null bytes and limits length to 10K characters.
 */
export function sanitizeCommand(cmd: string): string {
  if (typeof cmd !== 'string') return ''
  // Strip null bytes
  let clean = cmd.replace(/\0/g, '')
  // Limit length
  if (clean.length > MAX_COMMAND_LENGTH) {
    clean = clean.slice(0, MAX_COMMAND_LENGTH)
  }
  return clean
}

/**
 * Validate and sanitize a file path.
 * Must be absolute (starts with /), no path traversal (../), no null bytes.
 * Returns the cleaned path if valid, null if not.
 */
export function sanitizeFilePath(path: string): string | null {
  if (typeof path !== 'string') return null
  // Strip null bytes
  const clean = path.replace(/\0/g, '')
  // Must be absolute
  if (!clean.startsWith('/')) return null
  // No path traversal
  // Normalize and check for .. components
  const parts = clean.split('/')
  for (const part of parts) {
    if (part === '..') return null
  }
  // Additional check: no encoded traversal attempts
  if (clean.includes('%2e%2e') || clean.includes('%2E%2E')) return null
  return clean
}
