/**
 * Slash commands for Daemon chat.
 *
 * Two types:
 * - 'prompt': Injects a prompt template before sending to the model (like Claude Code skills)
 * - 'action': Runs a client-side action directly (navigation, device ops)
 */

export interface SlashCommand {
  name: string
  description: string
  type: 'prompt' | 'action'
  icon: string
  /** For 'prompt' type: the template injected as system context */
  promptTemplate?: string
  /** For 'action' type: the action identifier */
  actionId?: string
  /** Allowed tools (restricts what the model can do) */
  allowedTools?: string[]
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Git & Code ──────────────────────────────────────────
  {
    name: 'commit',
    description: 'Commit current changes with a clean message',
    type: 'prompt',
    icon: '📦',
    promptTemplate: `Based on the current git status and diff, create a single git commit.
Stage relevant files and commit with a clear, concise message following conventional commit format.
Do not commit files that likely contain secrets (.env, credentials). Do NOT push.

Context:
- Run \`git status\` to see changes
- Run \`git diff HEAD\` to see what changed
- Run \`git log --oneline -5\` to match commit style`,
    allowedTools: ['bash'],
  },
  {
    name: 'push',
    description: 'Commit, push, and optionally open a PR',
    type: 'prompt',
    icon: '🚀',
    promptTemplate: `Commit current changes, push to remote, and ask if I want to create a PR.
1. Stage and commit with a clear message
2. Push to the current branch
3. Ask if I want to create a PR with \`gh pr create\``,
    allowedTools: ['bash'],
  },
  {
    name: 'review',
    description: 'Review recent code changes',
    type: 'prompt',
    icon: '🔍',
    promptTemplate: `Review the recent code changes in this project. Look at:
1. \`git diff HEAD\` for unstaged/staged changes
2. Check for bugs, security issues, and code quality
3. Suggest improvements
Be concise — focus on real issues, not style nitpicks.`,
    allowedTools: ['bash'],
  },
  {
    name: 'simplify',
    description: 'Simplify and clean up recent code',
    type: 'prompt',
    icon: '✨',
    promptTemplate: `Review the recently changed code and simplify it:
1. Remove unnecessary complexity, dead code, unused imports
2. Improve readability without changing behavior
3. Check for code duplication that could be refactored
Show the diff of what you'd change before making changes.`,
    allowedTools: ['bash'],
  },

  // ── Daemon Native ───────────────────────────────────────
  {
    name: 'status',
    description: 'Show devices, services, and git status',
    type: 'prompt',
    icon: '📊',
    promptTemplate: `Show me the current status of everything:
1. Connected devices (check /api/devices or the WS health endpoint)
2. Running services (systemctl list-units --type=service --state=running | grep -v snap)
3. Git status of the current project
4. Any recent errors in the logs
Be brief — just the facts.`,
  },
  {
    name: 'deploy',
    description: 'Build and deploy the current project',
    type: 'prompt',
    icon: '🌐',
    promptTemplate: `Deploy the current project:
1. Check what kind of project this is (package.json → npm, requirements.txt → pip, Cargo.toml → cargo, etc.)
2. Build it
3. If it has a systemd service, restart it
4. If it has a domain, verify it's accessible
5. Report the live URL`,
  },
  {
    name: 'search',
    description: 'Search across project memory and history',
    type: 'prompt',
    icon: '🔎',
    promptTemplate: `Search across all project memory, conversation history, and codebase for information related to the user's query. Use:
1. Vector search via /api/memory?action=search if available
2. Grep through relevant files
3. Check git log for context
Report what you found concisely.`,
  },
  {
    name: 'devices',
    description: 'List all connected devices',
    type: 'action',
    icon: '📱',
    actionId: 'show_devices',
  },
  {
    name: 'pair',
    description: 'Link a new device',
    type: 'action',
    icon: '🔗',
    actionId: 'show_pairing',
  },
  {
    name: 'settings',
    description: 'Open settings (models, API keys, billing)',
    type: 'action',
    icon: '⚙️',
    actionId: 'open_settings',
  },
  {
    name: 'clear',
    description: 'Start a fresh conversation',
    type: 'action',
    icon: '🗑️',
    actionId: 'clear_chat',
  },

  // ── Research & Analysis ─────────────────────────────────
  {
    name: 'research',
    description: 'Deep research on a topic using multiple agents',
    type: 'prompt',
    icon: '🧠',
    promptTemplate: `Conduct deep research on the user's topic:
1. Search the web for current information
2. Search local project memory for relevant context
3. Cross-reference multiple sources
4. Provide a structured summary with sources cited
Take your time and be thorough.`,
  },
  {
    name: 'plan',
    description: 'Create an implementation plan before coding',
    type: 'prompt',
    icon: '📋',
    promptTemplate: `Before writing any code, create a detailed implementation plan:
1. Understand the current codebase structure (read key files)
2. Identify what needs to change
3. List the files to create/modify
4. Consider edge cases and potential issues
5. Present the plan for approval before proceeding`,
  },
]

/**
 * Match a slash command from user input.
 * Returns the command if input starts with /commandName, null otherwise.
 */
export function matchSlashCommand(input: string): { command: SlashCommand; args: string } | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null

  const spaceIdx = trimmed.indexOf(' ')
  const cmdName = spaceIdx > 0 ? trimmed.slice(1, spaceIdx) : trimmed.slice(1)
  const args = spaceIdx > 0 ? trimmed.slice(spaceIdx + 1).trim() : ''

  const command = SLASH_COMMANDS.find(c => c.name === cmdName.toLowerCase())
  if (!command) return null

  return { command, args }
}

/**
 * Get filtered commands for autocomplete dropdown.
 */
export function filterCommands(partial: string): SlashCommand[] {
  if (!partial.startsWith('/')) return []
  const query = partial.slice(1).toLowerCase()
  if (!query) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(c =>
    c.name.includes(query) || c.description.toLowerCase().includes(query)
  )
}
