#!/usr/bin/env node
/**
 * daemon CLI — lightweight device bridge.
 * Connects to the daemon server via WebSocket, provides shell access,
 * file operations, and device info. Runs as a persistent service.
 *
 * Usage:
 *   node daemon.mjs                    # Connect with defaults
 *   node daemon.mjs --server wss://my.daemon.page/ws/device
 *   node daemon.mjs --name "Arthur's Mac"
 *   node daemon.mjs --install          # Install as LaunchAgent (macOS) or systemd (Linux)
 *   node daemon.mjs --uninstall        # Remove service
 */

import { WebSocket } from 'ws' // will be bundled or use import map
import { exec } from 'child_process'
import { readFile, writeFile, readdir, stat, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { hostname, platform, arch, cpus, totalmem, freemem, userInfo } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Config ───────────────────────────────────────────────

const SERVER_URL = process.argv.find(a => a.startsWith('--server='))?.split('=')[1]
  || process.env.DAEMON_SERVER
  || 'wss://my.daemon.page/ws/device'

const DEVICE_NAME = process.argv.find(a => a.startsWith('--name='))?.split('=')[1]
  || process.env.DAEMON_DEVICE_NAME
  || `${userInfo().username}@${hostname()}`

const DEVICE_ID = `${hostname()}-${platform()}-${arch()}`

// ── Claude CLI Detection ─────────────────────────────────

function detectClaudeCli() {
  const paths = [
    join(userInfo().homedir, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    join(userInfo().homedir, '.nvm', 'versions', 'node'),  // might be in npm global
  ]
  // Windows paths
  if (platform() === 'win32') {
    paths.push(
      join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      join(process.env.LOCALAPPDATA || '', 'Programs', 'claude', 'claude.exe'),
    )
  }
  for (const p of paths) {
    if (existsSync(p)) return true
  }
  // Try running it
  try {
    const { execSync } = await import('child_process')
    // Can't use execSync at top level in ESM easily, use a flag
    return false // Will be detected on first run_claude command
  } catch { return false }
}

async function runClaudeCli(prompt, options = {}) {
  const claudePaths = [
    join(userInfo().homedir, '.local', 'bin', 'claude'),
    '/usr/local/bin/claude',
    'claude', // rely on PATH
  ]
  if (platform() === 'win32') {
    claudePaths.unshift(
      join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
      'claude.cmd',
    )
  }

  let claudeBin = 'claude'
  for (const p of claudePaths) {
    if (existsSync(p)) { claudeBin = p; break }
  }

  return new Promise((resolve) => {
    const args = ['-p', prompt, '--output-format', 'text']
    if (options.maxTokens) args.push('--max-tokens', String(options.maxTokens))

    const proc = exec(`"${claudeBin}" ${args.map(a => `"${a}"`).join(' ')}`, {
      timeout: options.timeout || 120000,
      maxBuffer: 1024 * 1024 * 5,
      env: { ...process.env, ANTHROPIC_API_KEY: '' }, // Force Max subscription, not API
    }, (error, stdout, stderr) => {
      resolve({
        response: stdout?.trim() || '',
        error: error ? stderr?.trim() || error.message : null,
        model: 'claude-max',
      })
    })
  })
}

// ── Clipboard Sync ───────────────────────────────────────

let lastClipboard = ''
let clipboardInterval = null

async function getClipboard() {
  const plat = platform()
  try {
    if (plat === 'darwin') {
      return (await new Promise((resolve) => {
        exec('pbpaste', { timeout: 2000 }, (_, stdout) => resolve(stdout || ''))
      }))
    } else if (plat === 'win32') {
      return (await new Promise((resolve) => {
        exec('powershell -c "Get-Clipboard"', { timeout: 2000 }, (_, stdout) => resolve(stdout?.trim() || ''))
      }))
    } else {
      // Linux — try xclip, then xsel
      return (await new Promise((resolve) => {
        exec('xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null', { timeout: 2000 }, (_, stdout) => resolve(stdout || ''))
      }))
    }
  } catch { return '' }
}

async function setClipboard(text) {
  const plat = platform()
  try {
    if (plat === 'darwin') {
      const proc = exec('pbcopy')
      proc.stdin?.write(text)
      proc.stdin?.end()
    } else if (plat === 'win32') {
      exec(`powershell -c "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`);
    } else {
      const proc = exec('xclip -selection clipboard 2>/dev/null || xsel --clipboard --input 2>/dev/null')
      proc.stdin?.write(text)
      proc.stdin?.end()
    }
  } catch {}
}

function startClipboardSync() {
  clipboardInterval = setInterval(async () => {
    if (!isConnected || !ws) return
    try {
      const current = await getClipboard()
      if (current && current !== lastClipboard && current.length < 50000) {
        lastClipboard = current
        ws.send(JSON.stringify({
          type: 'clipboard_update',
          content: current,
          source_device: DEVICE_ID,
          timestamp: Date.now(),
        }))
      }
    } catch {}
  }, 1000) // Check every second
}

function stopClipboardSync() {
  if (clipboardInterval) { clearInterval(clipboardInterval); clipboardInterval = null }
}

// ── Connection State ─────────────────────────────────────

let ws = null
let isConnected = false
let backoffMs = 1000
const MAX_BACKOFF = 60000
const HEARTBEAT_INTERVAL = 15000
let heartbeatTimer = null
let lastPong = Date.now()

// ── Logging ──────────────────────────────────────────────

const log = (msg) => console.log(`[daemon ${new Date().toISOString().slice(11, 19)}] ${msg}`)
const err = (msg) => console.error(`[daemon ${new Date().toISOString().slice(11, 19)}] ERROR: ${msg}`)

// ── Command Executor ─────────────────────────────────────

function runCommand(command, timeout = 30000) {
  return new Promise((resolve) => {
    const proc = exec(command, { timeout, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout?.slice(0, 10000) || '',
        stderr: stderr?.slice(0, 5000) || '',
        exit_code: error?.code || 0,
      })
    })
  })
}

async function getDeviceInfo() {
  return {
    hostname: hostname(),
    platform: platform(),
    arch: arch(),
    cpus: cpus().length,
    total_memory_gb: Math.round(totalmem() / 1024 / 1024 / 1024 * 10) / 10,
    free_memory_gb: Math.round(freemem() / 1024 / 1024 / 1024 * 10) / 10,
    user: userInfo().username,
    home: userInfo().homedir,
    node_version: process.version,
    uptime_hours: Math.round(process.uptime() / 3600 * 10) / 10,
  }
}

async function listFiles(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    const files = entries.slice(0, 200).map(e => ({
      name: e.name,
      is_dir: e.isDirectory(),
    }))
    return { path, files, count: files.length }
  } catch (e) {
    return { error: e.message }
  }
}

async function readFileContent(path) {
  try {
    const s = await stat(path)
    if (s.size > 1_000_000) return { error: 'File too large (>1MB)', size: s.size }
    const content = await readFile(path, 'utf-8')
    return { path, content, size: s.size }
  } catch (e) {
    return { error: e.message }
  }
}

async function receiveFile(filename, data) {
  try {
    const dir = join(userInfo().homedir, 'Downloads')
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    const filepath = join(dir, filename)
    const buf = Buffer.from(data, 'base64')
    await writeFile(filepath, buf)
    return { saved: true, filename, size: buf.length, path: filepath }
  } catch (e) {
    return { error: e.message }
  }
}

// ── Command Handler ──────────────────────────────────────

async function handleCommand(msg) {
  const type = msg.type
  const requestId = msg.request_id || ''

  let result
  switch (type) {
    case 'run_command':
      result = await runCommand(msg.command || '')
      break
    case 'get_device_info':
      result = await getDeviceInfo()
      break
    case 'run_claude':
      result = await runClaudeCli(msg.prompt || '', { timeout: msg.timeout || 120000 })
      break
    case 'list_files':
      result = await listFiles(msg.path || userInfo().homedir)
      break
    case 'read_file':
      result = await readFileContent(msg.path || '')
      break
    case 'receive_file':
      result = await receiveFile(msg.filename || 'file', msg.data || '')
      break
    case 'clipboard_update':
      // Another device copied something — write to our clipboard
      if (msg.content && msg.source_device !== DEVICE_ID) {
        lastClipboard = msg.content // prevent echo
        await setClipboard(msg.content)
        log(`Clipboard synced from ${msg.source_device} (${msg.content.slice(0, 40)}...)`)
      }
      return null
    case 'clipboard_history':
      result = { history: msg.history || [] }
      break
    case 'ping':
      result = { status: 'alive', uptime: process.uptime() }
      break
    case 'heartbeat_ack':
      lastPong = Date.now()
      return null
    case 'registered':
      log(`Registered: ${msg.message}`)
      startClipboardSync()
      return null
    default:
      result = { error: `Unknown command: ${type}` }
  }

  return {
    type: 'command_response',
    request_id: requestId,
    result,
  }
}

// ── WebSocket Connection ─────────────────────────────────

function connect() {
  log(`Connecting to ${SERVER_URL}...`)

  try {
    ws = new WebSocket(SERVER_URL)
  } catch (e) {
    err(`Failed to create WebSocket: ${e.message}`)
    scheduleReconnect()
    return
  }

  ws.on('open', () => {
    log('Connected!')
    isConnected = true
    backoffMs = 1000
    lastPong = Date.now()

    // Register device
    ws.send(JSON.stringify({
      type: 'device_register',
      device_id: DEVICE_ID,
      device_name: DEVICE_NAME,
      platform: platform(),
      arch: arch(),
      capabilities: {
        shell: true,
        files: true,
        admin: process.getuid?.() === 0 || false,
        node: true,
        git: existsSync('/usr/bin/git') || existsSync('/usr/local/bin/git') || existsSync('C:\\Program Files\\Git\\bin\\git.exe'),
        claude_cli: detectClaudeCli(),
      },
    }))

    // Start heartbeat
    startHeartbeat()
  })

  ws.on('message', async (data) => {
    lastPong = Date.now()
    try {
      const msg = JSON.parse(data.toString())
      const response = await handleCommand(msg)
      if (response && ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(response))
      }
    } catch (e) {
      err(`Message handling error: ${e.message}`)
    }
  })

  ws.on('close', (code, reason) => {
    log(`Disconnected: ${code} ${reason}`)
    isConnected = false
    stopHeartbeat()
    scheduleReconnect()
  })

  ws.on('error', (e) => {
    err(`WebSocket error: ${e.message}`)
    isConnected = false
    stopHeartbeat()
  })
}

function scheduleReconnect() {
  const jitter = Math.random() * backoffMs * 0.3
  const delay = backoffMs + jitter
  log(`Reconnecting in ${Math.round(delay / 1000)}s...`)
  setTimeout(connect, delay)
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF)
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (!isConnected) return

    const timeSinceLastMsg = Date.now() - lastPong
    if (timeSinceLastMsg > HEARTBEAT_INTERVAL + 10000) {
      log('Heartbeat timeout — reconnecting')
      isConnected = false
      try { ws?.close() } catch {}
      stopHeartbeat()
      backoffMs = 1000
      connect()
      return
    }

    try {
      ws?.send(JSON.stringify({
        type: 'heartbeat',
        timestamp: Date.now(),
      }))
    } catch {}
  }, HEARTBEAT_INTERVAL)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

// ── Service Installation ─────────────────────────────────

async function installService() {
  const plat = platform()

  if (plat === 'darwin') {
    // macOS LaunchAgent
    const plistPath = join(userInfo().homedir, 'Library', 'LaunchAgents', 'com.daemon.agent.plist')
    const daemonPath = process.argv[1] // This script's path
    const nodePath = process.execPath

    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.daemon.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${daemonPath}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${join(userInfo().homedir, '.daemon', 'daemon.log')}</string>
    <key>StandardErrorPath</key>
    <string>${join(userInfo().homedir, '.daemon', 'daemon.err')}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>
</dict>
</plist>`

    const daemonDir = join(userInfo().homedir, '.daemon')
    if (!existsSync(daemonDir)) await mkdir(daemonDir, { recursive: true })

    const launchAgentsDir = join(userInfo().homedir, 'Library', 'LaunchAgents')
    if (!existsSync(launchAgentsDir)) await mkdir(launchAgentsDir, { recursive: true })

    await writeFile(plistPath, plist)
    log(`Wrote LaunchAgent to ${plistPath}`)

    // Load the agent
    await runCommand(`launchctl load ${plistPath}`)
    log('LaunchAgent loaded! Daemon will start on login.')
    log(`Logs: ${daemonDir}/daemon.log`)

  } else if (plat === 'linux') {
    // systemd user service
    const serviceDir = join(userInfo().homedir, '.config', 'systemd', 'user')
    if (!existsSync(serviceDir)) await mkdir(serviceDir, { recursive: true })

    const servicePath = join(serviceDir, 'daemon-bridge.service')
    const daemonPath = process.argv[1]
    const nodePath = process.execPath

    const unit = `[Unit]
Description=Daemon Device Bridge
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${daemonPath}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
    await writeFile(servicePath, unit)
    await runCommand('systemctl --user daemon-reload')
    await runCommand('systemctl --user enable daemon-bridge')
    await runCommand('systemctl --user start daemon-bridge')
    log(`Installed systemd user service at ${servicePath}`)

  } else if (plat === 'win32') {
    log('Windows: Use Task Scheduler to run this script at login.')
    log(`Command: node "${process.argv[1]}"`)
  }
}

async function uninstallService() {
  const plat = platform()
  if (plat === 'darwin') {
    const plistPath = join(userInfo().homedir, 'Library', 'LaunchAgents', 'com.daemon.agent.plist')
    await runCommand(`launchctl unload ${plistPath}`)
    if (existsSync(plistPath)) {
      const { unlink } = await import('fs/promises')
      await unlink(plistPath)
    }
    log('LaunchAgent removed.')
  } else if (plat === 'linux') {
    await runCommand('systemctl --user stop daemon-bridge')
    await runCommand('systemctl --user disable daemon-bridge')
    log('Systemd service disabled.')
  }
}

// ── Main ─────────────────────────────────────────────────

if (process.argv.includes('--install')) {
  await installService()
  process.exit(0)
}

if (process.argv.includes('--uninstall')) {
  await uninstallService()
  process.exit(0)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
daemon CLI — device bridge for daemon.page

Usage:
  node daemon.mjs                     Connect with defaults
  node daemon.mjs --install           Install as background service
  node daemon.mjs --uninstall         Remove background service
  node daemon.mjs --server=URL        Custom server URL
  node daemon.mjs --name="My Device"  Custom device name

Environment:
  DAEMON_SERVER         WebSocket server URL
  DAEMON_DEVICE_NAME    Device display name
`)
  process.exit(0)
}

log(`daemon CLI v0.1.0`)
log(`Device: ${DEVICE_NAME} (${platform()}/${arch()})`)
log(`Server: ${SERVER_URL}`)

// Handle graceful shutdown
process.on('SIGINT', () => { log('Shutting down...'); process.exit(0) })
process.on('SIGTERM', () => { log('Shutting down...'); process.exit(0) })

connect()
