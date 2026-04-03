/**
 * Safety Bot — detects destructive shell commands before execution.
 *
 * Used by the agent loop to warn before running dangerous operations.
 * Returns a structured result with human-readable warnings.
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface SafetyResult {
  safe: boolean
  warning?: string
  details?: string
}

interface DestructivePattern {
  pattern: RegExp
  category: string
  describe: (match: RegExpMatchArray, cmd: string) => { warning: string; details: string }
}

const DESTRUCTIVE_PATTERNS: DestructivePattern[] = [
  // --- File deletion ---
  {
    pattern: /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f?|(?:-[a-zA-Z]*f[a-zA-Z]*)?)\s+(?:-[a-zA-Z]*\s+)*(.+)/,
    category: 'file-deletion',
    describe: (_m, cmd) => {
      const target = extractRmTarget(cmd)
      return {
        warning: `This will recursively delete '${target}'.`,
        details: `Command: ${cmd}`,
      }
    },
  },
  {
    pattern: /\brm\s+(?:-[a-zA-Z]*f[a-zA-Z]*)\s+(.+)/,
    category: 'file-deletion',
    describe: (_m, cmd) => {
      const target = extractRmTarget(cmd)
      return {
        warning: `This will force-delete '${target}' without confirmation.`,
        details: `Command: ${cmd}`,
      }
    },
  },
  // Windows deletion
  {
    pattern: /\b(?:del|erase)\s+\/[sS]\b/i,
    category: 'file-deletion',
    describe: (_m, cmd) => ({
      warning: 'This will recursively delete files (Windows del /s).',
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\b(?:rd|rmdir)\s+\/[sS]\b/i,
    category: 'file-deletion',
    describe: (_m, cmd) => ({
      warning: 'This will recursively remove a directory tree (Windows rd /s).',
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bRemove-Item\b.*-Recurse/i,
    category: 'file-deletion',
    describe: (_m, cmd) => ({
      warning: 'This will recursively delete items (PowerShell Remove-Item -Recurse).',
      details: `Command: ${cmd}`,
    }),
  },

  // --- Git destructive ---
  {
    pattern: /\bgit\s+reset\s+--hard\b/,
    category: 'git-destructive',
    describe: (_m, cmd) => ({
      warning: 'This will discard ALL uncommitted changes. They cannot be recovered.',
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bgit\s+push\s+(?:.*\s)?(?:--force|-f)\b/,
    category: 'git-destructive',
    describe: (_m, cmd) => ({
      warning: 'Force push will overwrite remote history. Other collaborators may lose work.',
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bgit\s+clean\s+-[a-zA-Z]*f[a-zA-Z]*d?/,
    category: 'git-destructive',
    describe: (_m, cmd) => ({
      warning: 'git clean will permanently remove untracked files and directories.',
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bgit\s+checkout\s+--\s+\./,
    category: 'git-destructive',
    describe: (_m, cmd) => ({
      warning: 'This will discard all unstaged changes in the working directory.',
      details: `Command: ${cmd}`,
    }),
  },

  // --- Database destructive ---
  {
    pattern: /\bDROP\s+TABLE\b/i,
    category: 'database',
    describe: (_m, cmd) => ({
      warning: 'DROP TABLE will permanently destroy the table and all its data.',
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bDROP\s+DATABASE\b/i,
    category: 'database',
    describe: (_m, cmd) => ({
      warning: 'DROP DATABASE will permanently destroy the entire database.',
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bTRUNCATE\b/i,
    category: 'database',
    describe: (_m, cmd) => ({
      warning: 'TRUNCATE will delete all rows from the table. This cannot be rolled back.',
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bDELETE\s+FROM\s+\S+(?:\s*;|\s*$)/i,
    category: 'database',
    describe: (_m, cmd) => ({
      warning: 'DELETE FROM without a WHERE clause will remove ALL rows from the table.',
      details: `Command: ${cmd}`,
    }),
  },

  // --- Service/process killing ---
  {
    pattern: /\bsystemctl\s+stop\s+(\S+)/,
    category: 'service',
    describe: (m, cmd) => ({
      warning: `This will stop the service '${m[1]}'. It may cause downtime.`,
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bkill\s+-9\s+/,
    category: 'service',
    describe: (_m, cmd) => ({
      warning: 'kill -9 forcefully terminates a process without cleanup. Data loss is possible.',
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\btaskkill\s+\/[fF]\b/,
    category: 'service',
    describe: (_m, cmd) => ({
      warning: 'taskkill /f forcefully terminates a Windows process without cleanup.',
      details: `Command: ${cmd}`,
    }),
  },

  // --- Package removal ---
  {
    pattern: /\bnpm\s+uninstall\s+(\S+)/,
    category: 'package',
    describe: (m, cmd) => ({
      warning: `This will uninstall the npm package '${m[1]}'. Dependent code may break.`,
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bpip\s+uninstall\s+(\S+)/,
    category: 'package',
    describe: (m, cmd) => ({
      warning: `This will uninstall the pip package '${m[1]}'. Dependent code may break.`,
      details: `Command: ${cmd}`,
    }),
  },
  {
    pattern: /\bapt\s+(?:remove|purge)\s+(\S+)/,
    category: 'package',
    describe: (m, cmd) => ({
      warning: `This will remove the system package '${m[1]}'.`,
      details: `Command: ${cmd}`,
    }),
  },
]

/** Extract the target path from an rm command, stripping flags */
function extractRmTarget(cmd: string): string {
  const parts = cmd.trim().split(/\s+/)
  // Skip 'rm' and any flags (starting with -)
  const targets = parts.slice(1).filter(p => !p.startsWith('-'))
  return targets.join(' ') || '(unknown)'
}

/** Estimate file count in a directory (best effort, non-blocking) */
async function estimateFileCount(dirPath: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(
      `find ${JSON.stringify(dirPath)} -maxdepth 3 -type f 2>/dev/null | head -5000 | wc -l`,
      { timeout: 5000 },
    )
    const count = parseInt(stdout.trim(), 10)
    return isNaN(count) ? null : count
  } catch {
    return null
  }
}

/**
 * Check a shell command for destructive operations.
 *
 * Returns { safe: true } if no issues found, or { safe: false, warning, details }
 * if the command matches a known destructive pattern.
 */
export async function checkSafety(command: string): Promise<SafetyResult> {
  const trimmed = command.trim()

  for (const dp of DESTRUCTIVE_PATTERNS) {
    const match = trimmed.match(dp.pattern)
    if (match) {
      const { warning, details } = dp.describe(match, trimmed)

      // For file deletions, try to estimate how many files will be affected
      if (dp.category === 'file-deletion') {
        const target = extractRmTarget(trimmed)
        const fileCount = await estimateFileCount(target)
        if (fileCount !== null && fileCount > 0) {
          const countStr = fileCount >= 5000 ? '5,000+' : fileCount.toLocaleString()
          return {
            safe: false,
            warning: `${warning} Estimated ${countStr} files affected.`,
            details,
          }
        }
      }

      return { safe: false, warning, details }
    }
  }

  return { safe: true }
}
