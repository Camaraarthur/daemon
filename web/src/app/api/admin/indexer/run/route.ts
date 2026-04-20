import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'
import { spawn } from 'child_process'
import { join } from 'path'

/**
 * POST /api/admin/indexer/run
 *
 * Trigger the chat->project auto-indexer for the authenticated user's
 * untitled / orphan threads. Runs the CLI script (cli/auto-indexer.mjs)
 * with --once --user-id <id>, scoped by default to writing (not --dry)
 * so the UI button actually reorganizes.
 *
 * Body: { dry?: boolean }
 * Returns: the indexer's SUMMARY line parsed as JSON.
 *
 * Why a child process instead of importing the indexer: the indexer is
 * an mjs CLI that opens SQLite directly (device + relay stores). Keeping
 * it out-of-process means the relay's Next.js runtime never touches the
 * device store, which matches the "relay holds metadata only" rule.
 */
export async function POST(req: NextRequest) {
  const authErr = requireAuth(req)
  if (authErr) return authErr

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let dry = false
  try {
    const body = await req.json().catch(() => ({}))
    dry = !!body?.dry
  } catch {}

  const DAEMON_ROOT = join(process.cwd(), '..')
  const SCRIPT = join(DAEMON_ROOT, 'cli', 'auto-indexer.mjs')

  const args = ['--once', '--user-id', String(userId)]
  if (dry) args.push('--dry')

  // Strip ANTHROPIC_API_KEY — the indexer uses the Max subscription via
  // the `claude` CLI, per feedback_never_anthropic_api.md.
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  delete env.ANTHROPIC_AUTH_TOKEN

  return await new Promise<NextResponse>((resolve) => {
    const child = spawn('node', [SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      cwd: DAEMON_ROOT,
      timeout: 180_000, // 3 min hard cap per run
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('error', (e) => {
      resolve(NextResponse.json(
        { error: `indexer spawn failed: ${e?.message || e}` },
        { status: 500 }
      ))
    })
    child.on('close', (code) => {
      // Pull the SUMMARY:{...} line the CLI emits last.
      const line = stdout.split('\n').reverse().find((l) => l.startsWith('SUMMARY:'))
      let summary: any = null
      if (line) {
        try { summary = JSON.parse(line.slice('SUMMARY:'.length)) } catch {}
      }
      resolve(NextResponse.json({
        ok: code === 0,
        code,
        summary,
        dry,
        stderr: stderr.slice(-400) || undefined,
      }))
    })
  })
}
