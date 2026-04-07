/**
 * Rich project context builder — the /resume equivalent for Daemon.
 *
 * When a user opens a project (or sends a chat with `projectId`), call
 * `buildProjectContext()` to get a system-prompt block that includes:
 *  - Their global rules (CLAUDE.md / user_rules table)
 *  - The project memory file (architecture, decisions, history)
 *  - The last session summary (recent thread messages)
 *  - Current state (git status, last commit, uncommitted files)
 *  - Connected device info (from WS health)
 *
 * The output is meant to be prepended to the model's system prompt.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import {
  getProject,
  getUserRules,
  getProjectMemory,
  listThreads,
  listMessages,
  listRecentMessages,
  countMessages,
  appendProjectMemory,
} from './db'

const execFileAsync = promisify(execFile)

const PROJECT_MEMORY_BUDGET_CHARS = 16_000   // ~4K tokens
const USER_RULES_BUDGET_CHARS = 8_000        // ~2K tokens
const SESSION_SUMMARY_MESSAGES = 10

function truncate(s: string | null | undefined, max: number): string {
  if (!s) return ''
  if (s.length <= max) return s
  return s.slice(0, max) + `\n... [truncated, ${s.length - max} chars omitted]`
}

async function safeExec(cmd: string, args: string[], cwd: string, timeoutMs = 3000): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { cwd, timeout: timeoutMs })
    return stdout.trim()
  } catch {
    return ''
  }
}

interface GitState {
  status: string
  lastCommit: string
  uncommittedCount: number
}

async function getGitState(localPath: string): Promise<GitState | null> {
  const fs = await import('fs')
  if (!fs.existsSync(localPath)) return null
  if (!fs.existsSync(`${localPath}/.git`)) return null

  const status = await safeExec('git', ['status', '--short'], localPath)
  const lastCommit = await safeExec('git', ['log', '-1', '--oneline'], localPath)
  const uncommittedCount = status ? status.split('\n').filter(Boolean).length : 0

  return { status, lastCommit, uncommittedCount }
}

async function getConnectedDevices(userId: number): Promise<Array<{ id: string; name: string; platform: string }>> {
  try {
    const res = await fetch('http://localhost:4801/health', { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return []
    const data: any = await res.json()
    const devices: any[] = data.devices || []
    return devices
      .filter((d: any) => d.connected && d.userId === userId)
      .map((d: any) => ({
        id: d.id,
        name: d.name || d.id,
        platform: d.platform || 'unknown',
      }))
  } catch {
    return []
  }
}

function buildLastSessionSummary(userId: number, projectId: number): string {
  const threads = listThreads(userId, projectId)
  if (threads.length === 0) return '(no prior sessions)'

  const mostRecent = threads[0]
  // Use listRecentMessages to get the LAST N messages (most recent activity).
  // Old code used listMessages(thread, 200) which returned the first 200 by ASC,
  // then slice(-10) of those — which would always show stale context for long threads.
  const tail = listRecentMessages(mostRecent.id, SESSION_SUMMARY_MESSAGES)
  const total = countMessages(mostRecent.id)
  if (tail.length === 0) return '(thread exists but no messages)'

  const lines: string[] = [
    `Thread: "${mostRecent.title}" (${mostRecent.last_message_at || mostRecent.created_at})`,
    `Total messages: ${total}`,
    `Last ${tail.length} messages (most recent activity):`,
  ]
  for (const m of tail) {
    if (!m.content) continue
    const role = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Daemon' : m.role
    const snippet = m.content.replace(/\s+/g, ' ').slice(0, 240)
    lines.push(`  - ${role}: ${snippet}`)
  }
  return lines.join('\n')
}

/**
 * Directive header — gives the model its voice, tools, and rules.
 * This is what makes Daemon's responses feel like Claude Code instead of a
 * generic chatbot. ~1.5K tokens, intentionally heavy on directive language.
 */
function buildDirectiveHeader(opts: {
  email?: string
  daemonName?: string
  projectName: string
}): string {
  const { email, daemonName, projectName } = opts
  const userIdLine = email ? `${email}'s daemon` : "the user's daemon"
  const nameLine = daemonName ? ` named "${daemonName}"` : ''

  return `You are a coding assistant integrated into Daemon, a multi-device AI agent platform.
You have access to the user's devices via the device bridge protocol, and you operate
with the same standards as Claude Code in the user's terminal. You are continuing work
on the "${projectName}" project.

## Your Core Identity
- You are talking to ${userIdLine}${nameLine}.
- The user prefers direct, technical responses. NO preamble. NO "I'll help you with that".
- You ship code, not summaries. The user reads diffs and outputs, not paragraphs.
- When the user says "ok go", they have already decided. Execute, don't re-ask.
- When the user is vague, take your best interpretation and run — don't ask clarifying
  questions about obvious things. But NEVER guess factual data (emails, URLs, hardware
  specs, API keys). If you don't know something factual → search or ask.

## Available Tools
- Shell commands on connected devices (via device bridge — ssh_run, device_info, list_devices)
- File read/write on connected devices and the local server
- Web search and content fetching (for docs, errors, library APIs)
- Memory search (vector + grep over the user's knowledge graph)
- Semantic file search by meaning, not keyword (use this BEFORE Glob/Grep when you don't
  know exact filenames)
- Git operations (status, diff, log; commit only when explicitly asked)
- Deploy to the user's daemon.page

## Critical Rules (enforced — do not violate)
1. NEVER invent data. Emails, URLs, file paths, API responses, hardware specs, contact
   info — if you don't know, search or ask. Hallucinated facts are the #1 way you lose
   the user's trust.
2. NEVER rebuild what already exists. Before writing new code, check the Project Memory
   below, grep the codebase, and search other repos. Reuse > rewrite. The user has a
   lot of existing code.
3. ALWAYS verify build artifacts before claiming success. For web: curl the URL. For
   APKs: unzip and grep for your changes. For firmware: read back from device. "BUILD
   SUCCESSFUL" alone is NOT proof your changes are live.
4. NEVER retry a failing approach without investigating root cause. If something fails,
   STOP. Read the actual state. Identify the specific root cause. Fix it once. Verify
   the fix in the build artifact BEFORE asking the user to test. Two failed attempts
   means try a fundamentally different approach.
5. NEVER edit a file without verifying it's the file actually being served. Check the
   running process, the tunnel target, the systemd service — confirm the URL maps to
   the file you're about to edit.
6. Be terse. The user reads diffs and command outputs, not narrative summaries. Skip
   the "Here's what I did" recap unless asked.
7. When editing files: use ABSOLUTE paths. When running shell commands: prefer the
   device bridge over the local server unless the task is server-side.
8. If a tool fails, report the exact error and your next step in one line. Don't
   speculate, don't apologize, don't pad.
9. Test end-to-end before reporting success. Actually curl the URL, check the page
   renders, verify the data shows up.

## When the User Says...
- "where is X" → use semantic file search FIRST, then grep
- "fix Y" → read the failing code, identify root cause, patch, verify in artifact
- "deploy" → check current branch, build, verify artifact contains your changes, deploy
- "what's up with Z" / "what was I doing" → read the Project Memory, Last Session
  Summary, and Current State below — then summarize in 2-3 sentences
- "ok go" → execute the plan you just outlined; don't re-ask
- "build X" → check if X already exists in this or another repo BEFORE writing code

The structured context below was loaded from the project DB, git state, and connected
devices at the moment of this request. Trust it as ground truth for "now".`
}

/**
 * Build the rich context block to prepend to a project chat's system prompt.
 *
 * Output structure:
 *   1. Directive header (identity, tools, rules, when-X-do-Y) — ~1.5K tokens
 *   2. Project memory (architecture, decisions) — up to 4K tokens
 *   3. User rules (CLAUDE.md content) — up to 2K tokens
 *   4. Last session summary (last 10 messages of most recent thread)
 *   5. Current state (git status, last commit, uncommitted)
 *   6. Connected devices
 */
export async function buildProjectContext(
  userId: number,
  projectId: number,
  opts: { email?: string; daemonName?: string } = {},
): Promise<string> {
  const project = getProject(userId, projectId)
  if (!project) return ''

  let userRules: string | null = null
  try { userRules = getUserRules(userId) } catch {}
  let projectMemoryRaw: string | null = null
  try { projectMemoryRaw = getProjectMemory(projectId) } catch {}

  const userRulesT = truncate(userRules, USER_RULES_BUDGET_CHARS)
  const projectMemory = truncate(projectMemoryRaw, PROJECT_MEMORY_BUDGET_CHARS)
  const lastSession = buildLastSessionSummary(userId, projectId)

  const gitState = project.local_path ? await getGitState(project.local_path) : null
  const devices = await getConnectedDevices(userId)

  const projectName = project.display_name || project.name

  const sections: string[] = []

  // 1. Directive header — sets identity, tools, and rules.
  sections.push(buildDirectiveHeader({
    email: opts.email,
    daemonName: opts.daemonName,
    projectName,
  }))

  // 2. Project block — quick facts.
  const projectFacts: string[] = [
    `## Active Project: ${projectName}`,
    `- Path: ${project.local_path || '(unset)'}`,
    `- Stack: ${project.stack || '(unspecified)'}`,
    `- Domain: ${project.domain || 'none'}`,
    `- Git branch: ${project.git_branch || 'main'}`,
    `- Last activity: ${project.last_active || 'never'}`,
  ]
  sections.push(projectFacts.join('\n'))

  // 3. User rules (CLAUDE.md equivalent).
  if (userRulesT) {
    sections.push(`## User's Global Rules (from their CLAUDE.md)\n${userRulesT}`)
  } else {
    sections.push(`## User's Global Rules\n(no custom rules saved — defaults apply: be terse, ship code, never invent data)`)
  }

  // 4. Project memory.
  if (projectMemory) {
    sections.push(`## Project Memory\n${projectMemory}`)
  } else {
    sections.push(`## Project Memory\n(none yet — will be generated as the conversation progresses)`)
  }

  // 5. Last session summary.
  sections.push(`## Last Session Summary\n${lastSession}`)

  // 6. Current state — git.
  const stateLines: string[] = []
  if (gitState) {
    stateLines.push(`- Git status:\n${gitState.status ? gitState.status.split('\n').map(l => '    ' + l).join('\n') : '    (clean)'}`)
    stateLines.push(`- Last commit: ${gitState.lastCommit || '(no commits)'}`)
    stateLines.push(`- Uncommitted files: ${gitState.uncommittedCount}`)
  } else if (project.local_path) {
    stateLines.push(`- local_path: ${project.local_path} (not a git repo or unreachable)`)
  } else {
    stateLines.push(`- (no local_path configured)`)
  }
  sections.push(`## Current State\n${stateLines.join('\n')}`)

  // 7. Connected devices.
  if (devices.length > 0) {
    sections.push(
      `## Connected Devices\n${devices.map(d => `- ${d.name} (${d.platform}, id=${d.id}) — shell, file read/write, sensors`).join('\n')}`
    )
  } else {
    sections.push(`## Connected Devices\n(none online — use web search and local tools only)`)
  }

  sections.push('You have everything you need above. Begin.')

  return sections.join('\n\n')
}

// ── Session summary auto-save ─────────────────────────────

const GEMINI_MODEL = 'gemini-3-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

async function summarizeWithGemini(text: string): Promise<string | null> {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) return null
  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `Summarize this Daemon coding session in 4-6 bullet points. Focus on: what was built/changed, decisions made, files touched, what's still pending. Be terse and factual.\n\n---\n${text.slice(0, 30_000)}`,
          }],
        }],
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const data: any = await res.json()
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null
  } catch {
    return null
  }
}

const summarizedThreads = new Set<string>()

/**
 * After a thread accumulates >= 10 messages, generate a summary and append to project memory.
 * Idempotent within a single process — won't summarize the same thread twice in a row.
 */
export async function appendSessionSummary(projectId: number, threadId: string): Promise<void> {
  try {
    const messages = listMessages(threadId, 200)
    if (messages.length < 10) return

    const cacheKey = `${threadId}:${messages.length}`
    if (summarizedThreads.has(cacheKey)) return

    const conversationText = messages
      .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content)
      .map(m => `${m.role}: ${m.content!.slice(0, 800)}`)
      .join('\n')

    const summary = await summarizeWithGemini(conversationText)
    if (!summary) return

    const date = new Date().toISOString().slice(0, 10)
    appendProjectMemory(projectId, `\n\n## Session ${date}\n${summary}`)
    summarizedThreads.add(cacheKey)
  } catch (e) {
    console.warn('[context] appendSessionSummary failed:', e)
  }
}
