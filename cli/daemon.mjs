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
import { existsSync, readFileSync } from 'fs'
import { hostname, platform, arch, cpus, totalmem, freemem, userInfo } from 'os'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import http from 'http'
import {
  getStore,
  upsertChatMessage,
  listChatMessages,
  countChatMessages,
  getStorePath,
  addFact,
  listFacts,
  grepFacts,
  countFacts,
  getMemoryBlock,
  getMemoryBlocks,
  upsertMemoryBlock,
  appendMemoryBlock,
  recallMemory,
} from './store.mjs'
import {
  setSecret,
  getSecret,
  deleteSecret,
  listSecrets,
  existsSecret,
  isVaultInitialized,
} from './secrets.mjs'
import {
  createSchedule,
  listSchedules,
  getSchedule,
  deleteSchedule,
  setEnabled as setScheduleEnabled,
  startScheduler,
  stopScheduler,
} from './scheduler.mjs'
import { startOpenServer, stopOpenServer } from './open-server.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Version ─────────────────────────────────────────────
const CLI_VERSION = '0.1.3'
const VERSION_CHECK_URL = 'https://my.daemon.page/cli/version.json'
const UPDATE_CHECK_INTERVAL = 6 * 60 * 60 * 1000 // 6 hours

// Auto-update is opt-out: --no-update or DAEMON_NO_UPDATE=1 disables it.
// Systemd services should always pass --no-update so the package manager
// (or operator) controls upgrades.
const NO_UPDATE = process.argv.includes('--no-update') || process.env.DAEMON_NO_UPDATE === '1'

// ── Config ───────────────────────────────────────────────

const CONFIG_DIR = join(userInfo().homedir, '.daemon')
const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

function loadConfig() {
  try {
    if (existsSync(CONFIG_PATH)) {
      return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
    }
  } catch {}
  return {}
}

async function saveConfig(data) {
  if (!existsSync(CONFIG_DIR)) await mkdir(CONFIG_DIR, { recursive: true })
  const existing = loadConfig()
  const merged = { ...existing, ...data }
  await writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2))
  return merged
}

const savedConfig = loadConfig()

const SERVER_URL = process.argv.find(a => a.startsWith('--server='))?.split('=')[1]
  || process.env.DAEMON_SERVER
  || savedConfig.server_url
  || 'wss://my.daemon.page/ws/device'

// Derive the HTTP base for relay-bound POSTs (e.g. scheduler fires) from
// the WS server URL: wss:// → https://, ws:// → http://, and strip the
// /ws/device suffix.
const RELAY_HTTP_BASE = SERVER_URL
  .replace(/^wss:\/\//, 'https://')
  .replace(/^ws:\/\//, 'http://')
  .replace(/\/ws\/device\/?$/, '')

const DEVICE_NAME = process.argv.find(a => a.startsWith('--name='))?.split('=')[1]
  || process.env.DAEMON_DEVICE_NAME
  || `${userInfo().username}@${hostname()}`

const DEVICE_ID = `${hostname()}-${platform()}-${arch()}`

// ── MCP Tool Definitions ────────────────────────────────
//
// Tool vocabulary matches Claude Code (bash, read_file, write_file,
// edit_file, glob, grep, list_files). Old names are kept as aliases
// for one release so existing clients don't break.

const MCP_TOOLS = [
  {
    name: 'bash',
    description: 'Execute a shell command on this device. Returns stdout, stderr, exit_code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to run' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        cwd: { type: 'string', description: 'Working directory (default: $HOME)' },
        conversation_id: { type: 'string', description: 'Persistent shell session id (Step 3 — same id reuses cwd/env)' },
      },
      required: ['command'],
    },
  },
  {
    name: 'read_file',
    description: 'Read the contents of a file. Returns content, size. Files >1MB rejected.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write content to a file. Creates the file (and parent dirs) if needed. Returns size + lines.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        content: { type: 'string', description: 'File content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description: 'Replace exactly one occurrence of old_string with new_string in a file. Errors if old_string is missing or appears more than once. Returns line delta.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
        old_string: { type: 'string', description: 'Exact text to replace (must be unique in the file)' },
        new_string: { type: 'string', description: 'Replacement text' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'list_files',
    description: 'List files and directories at a path. Returns files: [{name, is_dir, size?}].',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path (default: $HOME)' },
      },
    },
  },
  {
    name: 'glob',
    description: 'Find files matching a glob pattern. Returns sorted list. Uses ** for recursive.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Glob pattern, e.g. **/*.ts' },
        path: { type: 'string', description: 'Root directory to search from (default: cwd)' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'grep',
    description: 'Search file contents for a regex pattern via ripgrep. Returns matching lines with file:line:content.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Regex pattern' },
        path: { type: 'string', description: 'Directory or file to search (default: cwd)' },
        glob: { type: 'string', description: 'Glob filter, e.g. *.ts' },
        type: { type: 'string', description: 'File type filter, e.g. py, js, rust' },
        case_insensitive: { type: 'boolean' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'lint_file',
    description: 'Run a syntax/lint check on a file. Picks the right linter for the extension. Returns ok + errors.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute file path' },
      },
      required: ['path'],
    },
  },
  {
    name: 'device_info',
    description: 'Get device system information (OS, CPU, memory, hostname, uptime).',
    inputSchema: { type: 'object', properties: {} },
  },
]

// Back-compat: old names map to new implementations for one release.
const TOOL_ALIASES = {
  run_shell: 'bash',
  list_directory: 'list_files',
  get_system_info: 'device_info',
}

// ── MCP Tool Executor ───────────────────────────────────

async function executeMcpTool(name, args) {
  // Resolve alias to canonical name
  const canonical = TOOL_ALIASES[name] || name
  switch (canonical) {
    case 'bash':
      return await runBash(args.command || '', args.timeout_ms || 30000, args.cwd, args.conversation_id)
    case 'read_file':
      return await readFileContent(args.path || '')
    case 'write_file':
      return await writeFileContent(args.path || '', args.content || '')
    case 'edit_file':
      return await editFile(args.path || '', args.old_string || '', args.new_string || '')
    case 'list_files':
      return await listFiles(args.path || userInfo().homedir)
    case 'glob':
      return await globFiles(args.pattern || '*', args.path || process.cwd())
    case 'grep':
      return await grepFiles(args.pattern || '', args.path || process.cwd(), args.glob, args.type, args.case_insensitive)
    case 'lint_file':
      return await lintFile(args.path || '')
    case 'device_info':
      return await getDeviceInfo()
    default:
      return { error: `Unknown tool: ${name}` }
  }
}

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
  return false // Will be detected on first run_claude command
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
  log('Clipboard sync started')
  clipboardInterval = setInterval(async () => {
    if (!isConnected || !ws) return
    try {
      const current = await getClipboard()
      if (current && current !== lastClipboard && current.length < 50000) {
        lastClipboard = current
        log(`Clipboard changed: "${current.slice(0, 50)}..." → broadcasting`)
        ws.send(JSON.stringify({
          type: 'clipboard_update',
          content: current,
          source_device: DEVICE_ID,
          timestamp: Date.now(),
        }))
      }
    } catch (e) {
      err(`Clipboard poll error: ${e.message}`)
    }
  }, 1500)
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
//
// Persistent shell sessions per conversation_id via node-pty. State (cwd,
// env, exported funcs, shell history) survives across tool calls within
// the same conversation. Sessions GC after 30 minutes idle.
//
// This is the pattern every mature agent runtime converged on (OpenHands,
// Letta, the tmux-MCP crowd). Without it, `cd /tmp` silently evaporates
// between calls and the agent looks broken.

const MAX_STDOUT = 100_000  // 100 KB cap on tool call output
const PTY_IDLE_TIMEOUT_MS = 30 * 60 * 1000  // 30 minutes
const PTY_GC_INTERVAL_MS = 5 * 60 * 1000    // GC sweep every 5 minutes
const PTY_DEFAULT_TIMEOUT_MS = 30_000

// node-pty is a native dep — load it lazily so a missing build doesn't
// crash daemon startup, falling back to fresh-shell-per-call.
let _ptyLib = null
async function loadPty() {
  if (_ptyLib === false) return null
  if (_ptyLib) return _ptyLib
  try {
    _ptyLib = await import('node-pty')
    log('node-pty loaded — persistent shell sessions enabled')
    return _ptyLib
  } catch (e) {
    err(`node-pty unavailable, falling back to exec(): ${e.message}`)
    _ptyLib = false
    return null
  }
}

// Per-conversation pty session.
//   sessions: Map<conversationId, { pty, lastUsed, busy }>
const ptySessions = new Map()

// Marker emitted by every command so we know when output is complete.
// Includes a random nonce so prompts and unrelated output can't fake it.
function makeSentinel() {
  return `___DAEMON_DONE_${Math.random().toString(36).slice(2)}___`
}

async function getOrCreatePtySession(conversationId, initialCwd) {
  let session = ptySessions.get(conversationId)
  if (session) {
    session.lastUsed = Date.now()
    return session
  }
  const pty = await loadPty()
  if (!pty) return null

  // Spawn a bash that doesn't load rc files (clean env), in the requested cwd.
  const shell = process.env.SHELL || '/bin/bash'
  const ptyProc = pty.spawn(shell, ['--noprofile', '--norc', '-i'], {
    name: 'xterm-256color',
    cols: 200,
    rows: 50,
    cwd: initialCwd || userInfo().homedir,
    env: {
      ...process.env,
      // Disable command-not-found, custom prompts, etc.
      PS1: '$ ',
      PROMPT_COMMAND: '',
      TERM: 'xterm-256color',
      // Force LC for consistent output
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
    },
  })

  session = {
    conversationId,
    pty: ptyProc,
    buffer: '',
    lastUsed: Date.now(),
    busy: false,
    onData: null,
  }

  ptyProc.onData((data) => {
    session.buffer += data
    if (session.onData) session.onData(data)
  })

  ptyProc.onExit(({ exitCode }) => {
    log(`pty session ${conversationId} exited (code ${exitCode})`)
    ptySessions.delete(conversationId)
  })

  ptySessions.set(conversationId, session)

  // Disable terminal echo so commands don't get echoed back into our buffer.
  // Disable bracketed paste mode so we don't get \e[?2004h spam.
  // Set a stable PS1 we can detect/strip.
  ptyProc.write('stty -echo -onlcr 2>/dev/null; bind "set enable-bracketed-paste off" 2>/dev/null; PS1=""; PROMPT_COMMAND=""\n')

  // Drain initial output before first command runs.
  await new Promise((r) => setTimeout(r, 120))
  session.buffer = ''
  return session
}

// Run a command inside a persistent pty session and wait for the sentinel.
function runInPtySession(session, command, timeoutMs) {
  return new Promise((resolve) => {
    if (session.busy) {
      return resolve({
        ok: false,
        error: 'session busy with previous command',
        stdout: '',
        stderr: '',
        exit_code: 1,
      })
    }
    session.busy = true
    session.buffer = ''

    const sentinel = makeSentinel()
    let finished = false

    const finish = (result) => {
      if (finished) return
      finished = true
      session.busy = false
      session.onData = null
      clearTimeout(timer)
      resolve(result)
    }

    // Search for sentinel preceded by a newline AND followed by a space then
    // a number, so we never match the sentinel inside an echoed input line.
    const markerRe = new RegExp(`(?:^|\\n)${sentinel.replace(/[$.*+?^()|[\]{}\\]/g, '\\$&')} (\\d+)`)

    session.onData = () => {
      const m = session.buffer.match(markerRe)
      if (!m) return
      const idx = m.index + (m[0].startsWith('\n') ? 1 : 0)
      const exitCode = parseInt(m[1], 10) || 0
      let output = session.buffer.slice(0, idx)
      output = stripAnsi(output)
      if (output.length > MAX_STDOUT) {
        output = output.slice(0, MAX_STDOUT) + `\n... [truncated, ${output.length - MAX_STDOUT} more chars]`
      }
      finish({
        ok: exitCode === 0,
        stdout: output,
        stderr: '',
        exit_code: exitCode,
      })
    }

    const timer = setTimeout(() => {
      finish({
        ok: false,
        error: `timeout after ${timeoutMs}ms`,
        stdout: stripAnsi(session.buffer).slice(0, MAX_STDOUT),
        stderr: '',
        exit_code: 124,
      })
    }, timeoutMs)

    // Send the command + sentinel as ONE line. Echo is off so neither shows
    // up in the buffer until the shell actually runs them.
    session.pty.write(`${command}\nprintf '\\n%s %d\\n' '${sentinel}' $?\n`)
  })
}

// Strip basic ANSI escape sequences and CR from pty buffer.
// Echo is disabled at the pty level so we don't need to strip echoed input.
function stripAnsi(text) {
  // CSI sequences (color codes, cursor movement, etc.)
  // eslint-disable-next-line no-control-regex
  let cleaned = text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  // OSC and DCS sequences
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/\x1b[PX^_\]].*?\x1b\\/g, '')
  // Bracketed paste markers in case stty didn't catch them
  // eslint-disable-next-line no-control-regex
  cleaned = cleaned.replace(/\x1b\[\?2004[hl]/g, '')
  // Normalize line endings
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '')
  return cleaned.replace(/^\n+/, '').replace(/\n+$/, '')
}

// GC sweeper — kill idle pty sessions every 5 minutes.
setInterval(() => {
  const now = Date.now()
  for (const [id, session] of ptySessions) {
    if (now - session.lastUsed > PTY_IDLE_TIMEOUT_MS) {
      log(`GC pty session ${id} (idle ${Math.round((now - session.lastUsed) / 1000)}s)`)
      try { session.pty.kill() } catch {}
      ptySessions.delete(id)
    }
  }
}, PTY_GC_INTERVAL_MS).unref()

async function runBash(command, timeoutMs, cwd, conversationId) {
  const timeout = timeoutMs || PTY_DEFAULT_TIMEOUT_MS

  // Without a conversation_id we can't reuse a session — fall back to
  // a fresh shell per call. (Tools like ad-hoc curl don't need state.)
  if (!conversationId) {
    return new Promise((resolve) => {
      const opts = { timeout, maxBuffer: 4 * 1024 * 1024 }
      if (cwd) opts.cwd = cwd
      exec(command, opts, (error, stdout, stderr) => {
        const out = (stdout || '').toString()
        const errOut = (stderr || '').toString()
        resolve({
          ok: !error || error.code === 0,
          stdout: out.length > MAX_STDOUT ? out.slice(0, MAX_STDOUT) + `\n... [truncated]` : out,
          stderr: errOut.length > 20_000 ? errOut.slice(0, 20_000) + `\n... [truncated]` : errOut,
          exit_code: error?.code ?? 0,
          cwd: cwd || process.cwd(),
        })
      })
    })
  }

  // Persistent path: get or create the conversation's session, run command.
  const session = await getOrCreatePtySession(conversationId, cwd)
  if (!session) {
    // node-pty failed to load — fall back.
    return runBash(command, timeoutMs, cwd, undefined)
  }
  return runInPtySession(session, command, timeout)
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
    cwd: process.cwd(),
  }
}

async function listFiles(path) {
  try {
    const entries = await readdir(path, { withFileTypes: true })
    const files = []
    for (const e of entries.slice(0, 500)) {
      const entry = { name: e.name, is_dir: e.isDirectory() }
      if (!e.isDirectory()) {
        try {
          const s = await stat(join(path, e.name))
          entry.size = s.size
        } catch {}
      }
      files.push(entry)
    }
    return { ok: true, path, files, count: files.length, truncated: entries.length > 500 }
  } catch (e) {
    return { ok: false, error: e.message, path }
  }
}

async function readFileContent(path) {
  try {
    const s = await stat(path)
    if (s.size > 1_000_000) return { ok: false, error: 'File too large (>1MB)', size: s.size, path }
    const content = await readFile(path, 'utf-8')
    return { ok: true, path, content, size: s.size, lines: content.split('\n').length }
  } catch (e) {
    return { ok: false, error: e.message, path }
  }
}

async function writeFileContent(path, content) {
  try {
    // Ensure parent dir exists
    const dir = dirname(path)
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    await writeFile(path, content)
    return {
      ok: true,
      path,
      size: content.length,
      lines: content.split('\n').length,
    }
  } catch (e) {
    return { ok: false, error: e.message, path }
  }
}

async function editFile(path, oldString, newString) {
  try {
    if (!oldString) return { ok: false, error: 'old_string must not be empty', path }
    const original = await readFile(path, 'utf-8')
    // Count occurrences of oldString
    const occurrences = original.split(oldString).length - 1
    if (occurrences === 0) {
      return { ok: false, error: `old_string not found in ${path}`, path }
    }
    if (occurrences > 1) {
      return {
        ok: false,
        error: `old_string appears ${occurrences} times in ${path}; must be unique. Add surrounding context.`,
        path,
      }
    }
    const updated = original.replace(oldString, newString)
    await writeFile(path, updated)
    const oldLines = oldString.split('\n').length
    const newLines = newString.split('\n').length
    return {
      ok: true,
      path,
      lines_added: newLines,
      lines_removed: oldLines,
      net_lines: newLines - oldLines,
      total_size: updated.length,
    }
  } catch (e) {
    return { ok: false, error: e.message, path }
  }
}

// Glob via Node fs walk. Supports * (one segment) and ** (many segments).
// We avoid `fast-glob` to keep daemon.mjs zero-dep beyond ws.
async function globFiles(pattern, root) {
  try {
    const segments = pattern.split('/')
    const matches = []
    const MAX_RESULTS = 2000

    function segToRe(seg) {
      // Convert one glob segment to a regex part. ** is handled at the
      // walker level, not here.
      return seg
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]')
    }

    async function walk(dir, segIdx) {
      if (matches.length >= MAX_RESULTS) return
      if (segIdx >= segments.length) {
        matches.push(dir)
        return
      }
      const seg = segments[segIdx]
      // Recursive **: match zero or more dirs
      if (seg === '**') {
        // Match the rest at the current level too
        await walk(dir, segIdx + 1)
        let entries
        try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
        for (const e of entries) {
          if (e.name.startsWith('.git') || e.name === 'node_modules') continue
          if (e.isDirectory()) await walk(join(dir, e.name), segIdx)
        }
        return
      }
      const re = new RegExp(`^${segToRe(seg)}$`)
      let entries
      try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (!re.test(e.name)) continue
        const full = join(dir, e.name)
        const isLast = segIdx === segments.length - 1
        if (isLast) {
          matches.push(full)
        } else if (e.isDirectory()) {
          await walk(full, segIdx + 1)
        }
        if (matches.length >= MAX_RESULTS) return
      }
    }

    await walk(root, 0)
    matches.sort()
    return {
      ok: true,
      pattern,
      root,
      matches: matches.slice(0, MAX_RESULTS),
      count: matches.length,
      truncated: matches.length >= MAX_RESULTS,
    }
  } catch (e) {
    return { ok: false, error: e.message, pattern, root }
  }
}

// Grep via ripgrep. Falls back to a clear error if rg isn't installed.
function grepFiles(pattern, path, globFilter, typeFilter, caseInsensitive) {
  return new Promise((resolve) => {
    const args = ['--color=never', '--line-number', '--no-heading', '--max-count', '500', '--max-columns', '300']
    if (caseInsensitive) args.push('-i')
    if (globFilter) args.push('--glob', globFilter)
    if (typeFilter) args.push('--type', typeFilter)
    args.push('--', pattern, path)
    exec(`rg ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`,
      { maxBuffer: 4 * 1024 * 1024, timeout: 30000 },
      (error, stdout, stderr) => {
        // rg exits 1 when no matches found — that's not an error
        if (error && error.code !== 1) {
          return resolve({ ok: false, error: stderr?.trim() || error.message, pattern, path })
        }
        const lines = (stdout || '').split('\n').filter(Boolean)
        resolve({
          ok: true,
          pattern,
          path,
          matches: lines.slice(0, 500),
          count: lines.length,
          truncated: lines.length >= 500,
        })
      })
  })
}

// Lint via the right tool for the file extension.
function lintFile(path) {
  return new Promise((resolve) => {
    if (!existsSync(path)) {
      return resolve({ ok: false, error: `File not found: ${path}`, path })
    }
    const ext = path.split('.').pop()?.toLowerCase()
    let cmd
    switch (ext) {
      case 'ts':
      case 'tsx':
      case 'js':
      case 'jsx':
        // Use `node --check` for JS — fast, built-in, no dep on tsc.
        // For TS, fall back to /home/arthur/daemon/web's local tsc if it exists.
        if (ext === 'ts' || ext === 'tsx') {
          const localTsc = '/home/arthur/daemon/web/node_modules/.bin/tsc'
          if (existsSync(localTsc)) {
            cmd = `${localTsc} --noEmit --allowJs --target es2022 --module esnext --moduleResolution bundler "${path}" 2>&1 || true`
          } else {
            return resolve({ ok: true, path, skipped: true, reason: 'tsc not available — install typescript locally' })
          }
        } else {
          cmd = `node --check "${path}" 2>&1 || true`
        }
        break
      case 'py':
        cmd = `python3 -m py_compile "${path}" 2>&1 || true`
        break
      case 'rs':
        cmd = `rustc --edition 2021 --emit=metadata -o /dev/null "${path}" 2>&1 || true`
        break
      case 'go':
        cmd = `gofmt -e -l "${path}" 2>&1 || true`
        break
      case 'sh':
      case 'bash':
        cmd = `bash -n "${path}" 2>&1 || true`
        break
      case 'json':
        cmd = `python3 -c 'import json,sys; json.load(open("${path.replace(/"/g, '\\"')}"))' 2>&1 || true`
        break
      default:
        return resolve({ ok: true, path, skipped: true, reason: `No linter configured for .${ext}` })
    }
    exec(cmd, { maxBuffer: 1024 * 1024, timeout: 30000 }, (_error, stdout) => {
      const output = (stdout || '').trim()
      // hasError is true ONLY if the output is non-empty AND looks like an error.
      // Empty output → linter passed.
      const hasError = output.length > 0 && /error|syntaxerror|indentationerror|nameerror|importerror|TS\d+:|unexpected token|invalid/i.test(output)
      resolve({
        ok: !hasError,
        path,
        errors: hasError ? output.slice(0, 5000) : null,
      })
    })
  })
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
    // ── MCP Protocol Messages ──────────────────────────
    case 'skill.list':
      return {
        type: 'skill.list_result',
        request_id: requestId,
        tools: MCP_TOOLS,
      }

    case 'skill.invoke': {
      const toolName = msg.name
      const toolArgs = msg.arguments || {}
      log(`skill.invoke: ${toolName}(${JSON.stringify(toolArgs).slice(0, 100)})`)
      result = await executeMcpTool(toolName, toolArgs)
      return {
        type: 'skill.result',
        request_id: requestId,
        name: toolName,
        result,
      }
    }

    // ── Legacy Command Messages (backward compat) ──────
    case 'run_command':
      result = await runBash(msg.command || '', msg.timeout || 30000)
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

    // ── Gossip from the relay: chat message replication ──────
    // The relay pushes us chat messages so our local SQLite mirrors
    // every conversation we participate in. Idempotent — same id is
    // an in-place update (lets streaming content grow).
    case 'chat.message_imported': {
      try {
        upsertChatMessage(msg.message || msg)
      } catch (e) {
        err(`upsertChatMessage failed: ${e.message}`)
      }
      // No response needed — gossip is fire-and-forget.
      return null
    }

    // Allow relay/devops to query our local store for verification.
    case 'store.stats': {
      try {
        const db = getStore()
        const total = db.prepare('SELECT COUNT(*) as c FROM chat_messages').get().c
        const threads = db.prepare('SELECT COUNT(*) as c FROM chat_threads').get().c
        result = { ok: true, store_path: getStorePath(), total_messages: total, total_threads: threads }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    // Read chat messages from the local store. The relay calls this when
    // a user opens a thread — instead of reading its own (deprecated)
    // chat_messages table, it asks the user's device for the history.
    case 'chat.fetch_messages': {
      try {
        const threadId = String(msg.thread_id || '')
        if (!threadId) {
          result = { ok: false, error: 'thread_id required' }
          break
        }
        const limit = Number(msg.limit || 200)
        const sessionId = msg.source_session_id ? String(msg.source_session_id) : null
        const db = getStore()
        let rows
        if (sessionId) {
          rows = db.prepare(
            `SELECT * FROM chat_messages WHERE thread_id = ? AND source_session_id = ?
             ORDER BY created_at DESC LIMIT ?`,
          ).all(threadId, sessionId, limit)
        } else {
          rows = db.prepare(
            `SELECT * FROM chat_messages WHERE thread_id = ?
             ORDER BY created_at DESC LIMIT ?`,
          ).all(threadId, limit)
        }
        // Reverse to chronological order
        rows.reverse()
        const total = db.prepare(
          'SELECT COUNT(*) as c FROM chat_messages WHERE thread_id = ?',
        ).get(threadId).c
        result = { ok: true, messages: rows, total }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    // Get the latest source_session_id used in a thread (replaces the
    // relay-side getLatestSessionForThread query).
    case 'chat.get_latest_session': {
      try {
        const threadId = String(msg.thread_id || '')
        if (!threadId) { result = { ok: false, error: 'thread_id required' }; break }
        const db = getStore()
        const row = db.prepare(
          `SELECT source_session_id FROM chat_messages
           WHERE thread_id = ? AND source_session_id IS NOT NULL
           ORDER BY created_at DESC LIMIT 1`,
        ).get(threadId)
        result = { ok: true, source_session_id: row?.source_session_id || null }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    // ── Memory operations (Letta-style) ─────────────────────
    // The relay's agent loop dispatches memory tool calls here so the
    // device's local store is the single source of truth. The MCP server
    // (mcp-memory-server.mjs) reads/writes the same SQLite file directly,
    // so memory written via the daemon web UI is visible in Claude Code
    // terminal and vice versa.

    case 'memory.remember': {
      try {
        const id = addFact({
          project_id: msg.project_id || 1,
          category: msg.category || '',
          content: msg.content || '',
          source: msg.source,
          importance: msg.importance,
        })
        result = { ok: true, fact_id: id }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'memory.recall': {
      try {
        const hits = recallMemory(
          msg.project_id || 1,
          msg.query || '',
          msg.limit || 20,
        )
        result = { ok: true, count: hits.length, hits }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'memory.list_facts': {
      try {
        const facts = listFacts(
          msg.project_id || 1,
          msg.category || null,
          msg.limit || 50,
        )
        const counts = countFacts(msg.project_id || 1)
        result = { ok: true, total: counts.total, by_category: counts.by_category, facts }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'memory.get_block': {
      try {
        const block = getMemoryBlock(msg.project_id || 1, msg.label || '')
        result = block
          ? { ok: true, block }
          : { ok: false, error: `block not found: ${msg.label}` }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'memory.list_blocks': {
      try {
        const blocks = getMemoryBlocks(msg.project_id || 1)
        result = { ok: true, blocks }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'memory.update_block': {
      try {
        const maxChars = msg.max_chars || 4000
        const content = String(msg.content || '')
        if (content.length > maxChars) {
          result = { ok: false, error: `content (${content.length}) exceeds max_chars (${maxChars})` }
          break
        }
        upsertMemoryBlock(msg.project_id || 1, msg.label || '', content, maxChars)
        result = { ok: true }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'memory.append_block': {
      try {
        appendMemoryBlock(msg.project_id || 1, msg.label || '', msg.addition || '')
        const block = getMemoryBlock(msg.project_id || 1, msg.label || '')
        result = { ok: true, total_chars: block?.content?.length || 0 }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    // ── Secrets vault (encrypted at rest with AES-256-GCM) ─────
    // The agent's get_secret() / set_secret() agent tools route here.
    // Per vision.md §3.2 and the API broker layer, the relay-side
    // wrapper (web/src/lib/device-secrets.ts) checks the user vault
    // first, falls through to platform broker if not found.
    //
    // CRITICAL: secrets.get returns PLAINTEXT. Only use it inside the
    // agent loop's tool dispatch path. Never log, never persist on
    // the relay, never send to a browser.

    case 'secrets.set': {
      try {
        const r = setSecret(
          String(msg.name || ''),
          String(msg.value || ''),
          {
            category: msg.category || undefined,
            description: msg.description || undefined,
          },
        )
        result = r
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'secrets.get': {
      try {
        const value = getSecret(String(msg.name || ''))
        if (value === null) {
          result = { ok: false, error: 'not found' }
        } else {
          result = { ok: true, value }
        }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'secrets.delete': {
      try {
        const removed = deleteSecret(String(msg.name || ''))
        result = { ok: true, removed }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'secrets.list': {
      try {
        const list = listSecrets()
        result = { ok: true, count: list.length, secrets: list }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'secrets.exists': {
      try {
        result = { ok: true, exists: existsSecret(String(msg.name || '')) }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'secrets.status': {
      try {
        result = { ok: true, initialized: isVaultInitialized(), count: listSecrets().length }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    // ── Scheduler (vision.md §3.3) ─────────────────────────
    // Recurring agent runs. The device's tick loop fires due rows by
    // POSTing /api/schedule/fire on the relay; agent tools below let
    // the model create / list / cancel schedules from chat.

    case 'schedule.create': {
      try {
        result = createSchedule({
          name: String(msg.name || ''),
          cron: String(msg.cron || ''),
          prompt: String(msg.prompt || ''),
          thread_id: msg.thread_id || null,
          project_id: msg.project_id == null ? null : Number(msg.project_id),
          enabled: msg.enabled !== false,
        })
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'schedule.list': {
      try {
        const list = listSchedules()
        result = { ok: true, count: list.length, schedules: list }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'schedule.get': {
      try {
        const row = getSchedule(String(msg.name || ''))
        result = row
          ? { ok: true, schedule: row }
          : { ok: false, error: 'not found' }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'schedule.delete': {
      try {
        const removed = deleteSchedule(String(msg.name || ''))
        result = { ok: true, removed }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }

    case 'schedule.set_enabled': {
      try {
        const changed = setScheduleEnabled(String(msg.name || ''), !!msg.enabled)
        result = { ok: true, changed }
      } catch (e) {
        result = { ok: false, error: e.message }
      }
      break
    }
    default:
      result = { error: `Unknown command: ${type}` }
  }

  return {
    type: 'command_response',
    request_id: requestId,
    result,
  }
}

// ── Scheduler fire callback ──────────────────────────────
//
// Vision §3.3: when a schedule is due, the device wakes the relay's
// agent loop with the schedule's prompt. The relay endpoint is
// authenticated by the device_token (set during pairing) — without it
// we can't fire, so the call is a no-op until the device is paired.

async function fireScheduledRun(row) {
  const cfg = loadConfig()
  const token = cfg.device_token
  if (!token) {
    throw new Error('device not paired — no device_token; pair via web UI to enable scheduled runs')
  }
  const url = `${RELAY_HTTP_BASE}/api/schedule/fire`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      device_id: DEVICE_ID,
      schedule_name: row.name,
      prompt: row.prompt,
      thread_id: row.thread_id || null,
      project_id: row.project_id || null,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`relay ${res.status}: ${text.slice(0, 200)}`)
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

    // Register device (include device_token if paired + MCP tools)
    const currentConfig = loadConfig()
    ws.send(JSON.stringify({
      type: 'device_register',
      device_id: DEVICE_ID,
      device_name: DEVICE_NAME,
      platform: platform(),
      arch: arch(),
      device_token: currentConfig.device_token || undefined,
      tools: MCP_TOOLS,
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

    // Start the scheduler tick. The fire callback POSTs the relay to
    // wake the agent loop with the schedule's prompt as a fresh user
    // message in the tagged thread (vision.md §3.3).
    startScheduler({
      fire: fireScheduledRun,
      log: (m) => log(m),
    })

    // Start the loopback /open server (vision.md §4.2) so the chat
    // UI can render clickable file paths that open locally with the
    // OS default app. Bound to 127.0.0.1 only.
    startOpenServer({ log: (m) => log(m) })
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
    stopScheduler()
    stopOpenServer()
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

// ── Auto-Update ─────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        return httpGet(res.headers.location).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve(data))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}

async function checkForUpdate() {
  if (NO_UPDATE) return false
  try {
    const raw = await httpGet(VERSION_CHECK_URL)
    const info = JSON.parse(raw)
    if (!info.version || !info.url) return false

    if (compareVersions(CLI_VERSION, info.version) >= 0) {
      return false // already up to date
    }

    log(`Update available: ${CLI_VERSION} -> ${info.version}`)
    log(`Downloading from ${info.url}...`)

    const newCode = await httpGet(info.url)
    if (!newCode || newCode.length < 100) {
      err('Downloaded file too small, skipping update')
      return false
    }

    // Write to the current script location
    const scriptPath = fileURLToPath(import.meta.url)
    await writeFile(scriptPath, newCode)
    log(`Updated from ${CLI_VERSION} to ${info.version}`)
    return true
  } catch (e) {
    err(`Update check failed: ${e.message}`)
    return false
  }
}

async function checkAndRestart() {
  const updated = await checkForUpdate()
  if (updated) {
    log('Restarting with new version...')
    const scriptPath = fileURLToPath(import.meta.url)
    const { spawn: spawnProcess } = await import('child_process')
    const child = spawnProcess(process.execPath, [scriptPath, ...process.argv.slice(2)], {
      detached: true,
      stdio: 'inherit',
    })
    child.unref()
    process.exit(0)
  }
}

function startUpdateChecker() {
  setInterval(async () => {
    await checkAndRestart()
  }, UPDATE_CHECK_INTERVAL)
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
daemon CLI �� device bridge for daemon.page

Usage:
  node daemon.mjs                     Connect with defaults
  node daemon.mjs pair <CODE>         Pair this device with a 6-char code
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

// ── Pair Command ────────────────────────────────────────

if (process.argv.includes('pair')) {
  const pairIdx = process.argv.indexOf('pair')
  const code = process.argv[pairIdx + 1]

  if (!code) {
    console.error('Usage: daemon pair <CODE>')
    console.error('Get a pairing code from daemon.page → Link Device')
    process.exit(1)
  }

  log(`Pairing with code: ${code.toUpperCase()}`)

  try {
    const pairUrl = 'https://my.daemon.page/api/pair'
    const body = JSON.stringify({
      action: 'claim',
      code: code.toUpperCase(),
      device_id: DEVICE_ID,
      device_name: DEVICE_NAME,
      platform: platform(),
    })

    const response = await new Promise((resolve, reject) => {
      const req = https.request(pairUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data)
            if (res.statusCode !== 200) reject(new Error(parsed.error || `HTTP ${res.statusCode}`))
            else resolve(parsed)
          } catch (e) { reject(new Error(`Bad response: ${data}`)) }
        })
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })

    // Save token
    await saveConfig({
      device_token: response.device_token,
      server_url: response.ws_url,
    })

    log('Device paired successfully!')
    log(`Token saved to ${CONFIG_PATH}`)
    log('Run `daemon` to connect.')
    process.exit(0)
  } catch (e) {
    err(`Pairing failed: ${e.message}`)
    process.exit(1)
  }
}

log(`daemon CLI v${CLI_VERSION}`)
log(`Device: ${DEVICE_NAME} (${platform()}/${arch()})`)
log(`Server: ${SERVER_URL}`)

// Initialize the local SQLite store. node:sqlite is experimental in Node 22
// but stable enough for our schema; the warning is suppressed by NO_WARNINGS.
try {
  getStore()
  const initialCount = countChatMessages('') // 0 if empty, just confirms the table works
  void initialCount
  log(`Store ready at ${getStorePath()}`)
} catch (e) {
  err(`Failed to initialize local store: ${e.message}`)
}

// Handle graceful shutdown
process.on('SIGINT', () => { log('Shutting down...'); process.exit(0) })
process.on('SIGTERM', () => { log('Shutting down...'); process.exit(0) })

// Check for updates on startup (blocks before connecting)
await checkAndRestart().catch(() => {})

// Start periodic update checker (every 6 hours)
startUpdateChecker()

connect()
