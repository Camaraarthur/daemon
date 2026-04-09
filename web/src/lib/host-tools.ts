/**
 * Hosting primitive (vision §4.1).
 *
 * Every user gets a public-facing subdomain at <daemon_name>.daemon.page.
 * The agent calls host_publish(path, content, visibility) and a static
 * file lands at data/sites/<daemon_name>/<path>. The relay's existing
 * /api/hosted/[...path] route + middleware subdomain rewrite handle
 * serving — we just need a write path the agent can call.
 *
 * Architecture critic finding M-4 fix: realpath both sides before any
 * write, so a path like "../../etc/shadow" or a symlink trick can't
 * escape the user's site directory. The route's read path got the
 * same fix in the same commit.
 *
 * Visibility:
 *   - "public" → data/sites/<daemon_name>/<path>
 *   - "private" → data/sites/<daemon_name>/private/<path>
 *     (Cloudflare Access gates the /private/ prefix at the edge —
 *     v1.5 wires the access policy; for now it's just a path
 *     convention so the agent can already structure files correctly.)
 *
 * Security model:
 *   - Hosting is STATIC. There is no execution path from the public
 *     internet back to the user's daemon device through this primitive.
 *   - Content is whatever the agent passes — HTML, JSON, SVG, plain
 *     text, etc. We do NOT serve dotfiles or extensions on a deny list.
 *   - Per-user quotas are v1.5 (architecture critic finding for v1.5).
 */

import { mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync, existsSync, realpathSync } from 'fs'
import { join, resolve as resolvePath, dirname, sep } from 'path'
import getDb from './db'

const DAEMON_ROOT = join(process.cwd(), '..')
const SITES_DIR = join(DAEMON_ROOT, 'data', 'sites')

function getDaemonName(userId: number): string | null {
  const row = getDb()
    .prepare('SELECT daemon_name FROM users WHERE id = ?')
    .get(userId) as { daemon_name: string } | undefined
  return row?.daemon_name || null
}

function ensureUserSiteDir(daemonName: string): string {
  if (!existsSync(SITES_DIR)) mkdirSync(SITES_DIR, { recursive: true, mode: 0o755 })
  const dir = join(SITES_DIR, daemonName)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 })
  return dir
}

function safeJoin(siteRoot: string, relPath: string): { ok: true; path: string } | { ok: false; error: string } {
  // Strip leading /, normalize
  const rel = relPath.replace(/^\/+/, '')
  if (!rel) return { ok: false, error: 'path required' }
  // Reject obvious traversal early — realpath catches the rest.
  for (const part of rel.split('/')) {
    if (part === '..' || part.startsWith('.') || part.includes('\0')) {
      return { ok: false, error: `forbidden segment: ${part}` }
    }
  }
  const target = resolvePath(siteRoot, rel)

  // Architecture critic finding H-1: walk up to the nearest existing
  // ancestor and realpath THAT, not the un-resolved dirname. The
  // previous code's "parent doesn't exist → trust it" branch was a
  // hole — a path resolved BENEATH a directory that didn't exist yet
  // could end up outside the site root once mkdir created the chain.
  const realRoot = realpathSync(siteRoot)
  let probe = dirname(target)
  let realProbe: string | null = null
  // Walk up the parent chain until we find a directory that exists.
  // The walk is bounded by the resolved path length so it always
  // terminates.
  for (let i = 0; i < 64; i++) {
    if (existsSync(probe)) {
      try {
        realProbe = realpathSync(probe)
      } catch {
        return { ok: false, error: 'realpath failed' }
      }
      break
    }
    const parent = dirname(probe)
    if (parent === probe) break // hit filesystem root
    probe = parent
  }
  if (!realProbe) {
    return { ok: false, error: 'no existing ancestor' }
  }
  // The nearest existing ancestor must be under (or equal to) the
  // realpathed site root.
  if (realProbe !== realRoot && !realProbe.startsWith(realRoot + sep)) {
    return { ok: false, error: 'path escapes site root' }
  }
  return { ok: true, path: target }
}

export interface HostToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const HOST_TOOLS: HostToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'host_publish',
      description:
        'Publish a static file to the user\'s public subdomain at <username>.daemon.page. Use this when the user asks you to "make me a webpage", "host this", "deploy this dashboard", or any time you generate HTML/JSON/SVG/CSS/JS that should be reachable via a URL. The file lives on the relay (because the public internet has to fetch it) and is served by Cloudflare. Returns the public URL. visibility="private" puts the file under /private/ which will be Cloudflare-Access-gated in v1.5; for now it\'s just a path convention.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Relative path under the user\'s site root, e.g. "index.html", "dashboard/app.js", "api/data.json". No leading slash, no .. segments, no leading dots.',
          },
          content: {
            type: 'string',
            description: 'The full file contents (UTF-8 text). Max 2 MB. For binary files, base64-encode and use a tool like a build script to decode (not yet supported in v1).',
          },
          visibility: {
            type: 'string',
            enum: ['public', 'private'],
            description: 'public = world-readable. private = under /private/ (Cloudflare Access gated, v1.5). Default: public.',
          },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'host_list',
      description: 'List every file the user has published to their <username>.daemon.page subdomain. Returns paths, sizes, and last modified times.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'host_delete',
      description: 'Delete a previously published file from <username>.daemon.page.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The same relative path passed to host_publish.' },
        },
        required: ['path'],
      },
    },
  },
]

export const HOST_TOOL_NAMES = new Set(HOST_TOOLS.map((t) => t.function.name))
export const IDEMPOTENT_HOST_TOOLS = new Set(['host_list'])

const MAX_CONTENT_BYTES = 2 * 1024 * 1024 // 2 MB

export async function executeHostTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { userId: number },
): Promise<string> {
  if (!ctx.userId) return 'Error: hosting tools require a user context.'
  const daemonName = getDaemonName(ctx.userId)
  if (!daemonName) return `Error: no daemon_name for userId ${ctx.userId}`

  try {
    switch (toolName) {
      case 'host_publish': {
        const rawPath = String(args.path || '')
        const content = String(args.content || '')
        const visibility = String(args.visibility || 'public')
        if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
          return JSON.stringify({ ok: false, error: `content exceeds 2 MB limit` })
        }
        const siteRoot = ensureUserSiteDir(daemonName)
        const relPath = visibility === 'private' ? join('private', rawPath) : rawPath
        const safe = safeJoin(siteRoot, relPath)
        if (!safe.ok) return JSON.stringify({ ok: false, error: safe.error })

        mkdirSync(dirname(safe.path), { recursive: true, mode: 0o755 })
        writeFileSync(safe.path, content, 'utf8')

        // Build the public URL the user can hit. Private files are
        // not directly URL-able yet (Cloudflare Access gate is v1.5)
        // so we return the path the user will see once it's wired.
        const cleanRel = relPath.replace(/^\/+/, '')
        const url = `https://${daemonName}.daemon.page/${cleanRel}`
        return JSON.stringify({
          ok: true,
          path: cleanRel,
          url,
          size: content.length,
          visibility,
          note: visibility === 'private'
            ? 'Private files will be Cloudflare-Access-gated in v1.5. For now this URL is reachable but unauthenticated — do not put secrets here yet.'
            : undefined,
        })
      }

      case 'host_list': {
        if (!existsSync(SITES_DIR)) {
          return JSON.stringify({ ok: true, count: 0, files: [], subdomain: `${daemonName}.daemon.page` })
        }
        const siteRoot = join(SITES_DIR, daemonName)
        if (!existsSync(siteRoot)) {
          return JSON.stringify({ ok: true, count: 0, files: [], subdomain: `${daemonName}.daemon.page` })
        }
        const files: Array<{ path: string; size: number; modified: string; visibility: string }> = []
        const walk = (dir: string, prefix: string) => {
          for (const name of readdirSync(dir)) {
            const full = join(dir, name)
            const st = statSync(full)
            const rel = prefix ? `${prefix}/${name}` : name
            if (st.isDirectory()) {
              walk(full, rel)
            } else {
              files.push({
                path: rel,
                size: st.size,
                modified: st.mtime.toISOString(),
                visibility: rel.startsWith('private/') ? 'private' : 'public',
              })
            }
          }
        }
        walk(siteRoot, '')
        return JSON.stringify({
          ok: true,
          subdomain: `${daemonName}.daemon.page`,
          count: files.length,
          files: files.slice(0, 200),
        })
      }

      case 'host_delete': {
        const rawPath = String(args.path || '')
        const siteRoot = join(SITES_DIR, daemonName)
        if (!existsSync(siteRoot)) {
          return JSON.stringify({ ok: false, error: 'no site directory' })
        }
        const safe = safeJoin(siteRoot, rawPath)
        if (!safe.ok) return JSON.stringify({ ok: false, error: safe.error })
        if (!existsSync(safe.path)) {
          return JSON.stringify({ ok: false, error: 'not found' })
        }
        const st = statSync(safe.path)
        // Architecture critic finding H-6: refuse to delete
        // directories. The agent must delete files individually so
        // it can't accidentally nuke an entire subtree by passing
        // a directory name. v1.5 can add an explicit `recursive:true`
        // opt-in flag if a use case emerges.
        if (st.isDirectory()) {
          return JSON.stringify({
            ok: false,
            error: 'host_delete refuses directories — list files with host_list and delete each one',
          })
        }
        unlinkSync(safe.path)
        return JSON.stringify({ ok: true, path: rawPath })
      }

      default:
        return `Error: unknown host tool: ${toolName}`
    }
  } catch (e) {
    return `Error in ${toolName}: ${e instanceof Error ? e.message : String(e)}`
  }
}
