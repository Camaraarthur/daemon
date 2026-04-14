/**
 * page_* tools — structured updates to the user's published page at
 * <daemon_name>.daemon.page.
 *
 * Instead of writing raw HTML to index.html, the agent mutates a page
 * model (data/sites/<daemon_name>/page.json) by section, and the
 * template renders the polished index.html. This makes incremental
 * updates trivial: "write 'demo time' on your page" just calls
 * page_add_section and the layout is handled for us.
 *
 * Source of truth: page.json. On every mutation we re-render index.html.
 * Writes are atomic-ish: if the page.json write fails we don't touch
 * index.html; if the index.html write fails we do our best to roll
 * page.json back.
 */

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
} from 'fs'
import { join, dirname } from 'path'
import getDb from './db'
import {
  renderIndexHtml,
  type PageModel,
  type PageSection,
  type PagePhoto,
} from './page-template'

const DAEMON_ROOT = join(process.cwd(), '..')
const SITES_DIR = join(DAEMON_ROOT, 'data', 'sites')

function getDaemonName(userId: number): string | null {
  const row = getDb()
    .prepare('SELECT daemon_name FROM users WHERE id = ?')
    .get(userId) as { daemon_name: string } | undefined
  return row?.daemon_name || null
}

function siteDir(daemonName: string): string {
  const dir = join(SITES_DIR, daemonName)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o755 })
  return dir
}

function defaultModel(daemonName: string): PageModel {
  return {
    title: daemonName,
    tagline: 'my daemon',
    sections: [],
    gallery: [],
    daemon_name: daemonName,
    updated_at: Date.now(),
  }
}

function loadModel(daemonName: string): PageModel {
  const dir = siteDir(daemonName)
  const p = join(dir, 'page.json')
  if (!existsSync(p)) return defaultModel(daemonName)
  try {
    const raw = readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PageModel>
    return {
      title: parsed.title,
      tagline: parsed.tagline,
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
      gallery: Array.isArray(parsed.gallery) ? parsed.gallery : [],
      daemon_name: daemonName,
      updated_at: parsed.updated_at || Date.now(),
    }
  } catch {
    return defaultModel(daemonName)
  }
}

function saveModel(daemonName: string, model: PageModel): { url: string } {
  const dir = siteDir(daemonName)
  model.updated_at = Date.now()
  model.daemon_name = daemonName

  const jsonPath = join(dir, 'page.json')
  const htmlPath = join(dir, 'index.html')

  // Write page.json atomically via tmp + rename.
  const tmpJson = jsonPath + '.tmp'
  writeFileSync(tmpJson, JSON.stringify(model, null, 2), 'utf8')

  // Render before committing page.json so a render failure leaves
  // page.json untouched.
  const html = renderIndexHtml(model)
  const tmpHtml = htmlPath + '.tmp'
  writeFileSync(tmpHtml, html, 'utf8')

  // Both tmp files written. Commit.
  renameSync(tmpJson, jsonPath)
  renameSync(tmpHtml, htmlPath)

  return { url: `https://${daemonName}.daemon.page/` }
}

function savePhotoFromBase64(
  daemonName: string,
  b64: string,
): { url: string; path: string } {
  const dir = siteDir(daemonName)
  const photosDir = join(dir, 'photos')
  if (!existsSync(photosDir)) mkdirSync(photosDir, { recursive: true, mode: 0o755 })
  // Strip a data URL prefix if present.
  const clean = b64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '')
  const buf = Buffer.from(clean, 'base64')
  const ts = Date.now()
  const fname = `${ts}.jpg`
  const full = join(photosDir, fname)
  writeFileSync(full, buf)
  return { url: `/photos/${fname}`, path: full }
}

export const PAGE_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'page_set_title',
      description:
        "Set the title and optional tagline on the user's public page at <daemon_name>.daemon.page. Use when the user asks you to name/rename their page or change the headline.",
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Page title (hero heading).' },
          tagline: {
            type: 'string',
            description: 'Optional subtitle under the title.',
          },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'page_add_section',
      description:
        "Add or replace a content card on the user's page. Sections are addressed by heading — calling page_add_section with an existing heading replaces that card's body. Use this for anything text-shaped: announcements, notes, lists, status. body_html may contain basic HTML (p, ul, ol, a, strong, em, code, img). <script> is stripped.",
      parameters: {
        type: 'object',
        properties: {
          heading: { type: 'string', description: 'Section heading (also the key used to update/replace).' },
          body_html: { type: 'string', description: 'HTML body of the section.' },
          position: {
            type: 'string',
            enum: ['top', 'bottom'],
            description: 'Where to insert a new section. Default: top.',
          },
        },
        required: ['heading', 'body_html'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'page_add_photo',
      description:
        "Add a photo to the page gallery. Provide EITHER image_url (absolute or site-relative) OR image_base64 (raw base64, JPG/PNG). For phone.take_photo results, pass the base64 directly — it will be saved under /photos/ and added to the gallery.",
      parameters: {
        type: 'object',
        properties: {
          image_url: { type: 'string', description: 'Existing image URL to reference.' },
          image_base64: { type: 'string', description: 'Raw base64 image bytes (JPG/PNG). A data: URL prefix is tolerated.' },
          caption: { type: 'string', description: 'Optional caption.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'page_clear_section',
      description: "Remove a section by heading from the user's page.",
      parameters: {
        type: 'object',
        properties: {
          heading: { type: 'string', description: 'Heading of the section to remove.' },
        },
        required: ['heading'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'page_reset',
      description:
        "Wipe the user's page back to the default template (empty sections, empty gallery, default title/tagline). Destructive — does not touch /photos/ files on disk but clears the gallery reference.",
      parameters: { type: 'object', properties: {} },
    },
  },
]

export const PAGE_TOOL_NAMES = new Set(PAGE_TOOLS.map((t) => t.function.name))

export function isPageTool(name: string): boolean {
  return PAGE_TOOL_NAMES.has(name)
}

export async function executePageTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { userId: number },
): Promise<string> {
  if (!ctx.userId) return 'Error: page tools require a user context.'
  const daemonName = getDaemonName(ctx.userId)
  if (!daemonName) return `Error: no daemon_name for userId ${ctx.userId}`

  try {
    switch (toolName) {
      case 'page_set_title': {
        const title = String(args.title || '').trim()
        if (!title) return JSON.stringify({ ok: false, error: 'title required' })
        const model = loadModel(daemonName)
        model.title = title
        if (typeof args.tagline === 'string') model.tagline = args.tagline
        const { url } = saveModel(daemonName, model)
        return JSON.stringify({ ok: true, url, title: model.title, tagline: model.tagline })
      }

      case 'page_add_section': {
        const heading = String(args.heading || '').trim()
        const body_html = String(args.body_html || '')
        if (!heading) return JSON.stringify({ ok: false, error: 'heading required' })
        const position = args.position === 'bottom' ? 'bottom' : 'top'
        const model = loadModel(daemonName)
        const idx = model.sections.findIndex(
          (s) => s.heading.toLowerCase() === heading.toLowerCase(),
        )
        const entry: PageSection = { heading, body_html, ts: Date.now() }
        if (idx >= 0) {
          model.sections[idx] = entry
        } else if (position === 'top') {
          model.sections.unshift(entry)
        } else {
          model.sections.push(entry)
        }
        const { url } = saveModel(daemonName, model)
        return JSON.stringify({ ok: true, url, sections: model.sections.length, heading })
      }

      case 'page_add_photo': {
        const caption = typeof args.caption === 'string' ? args.caption : undefined
        let urlRef: string | null = null
        if (typeof args.image_base64 === 'string' && args.image_base64.length > 0) {
          const { url } = savePhotoFromBase64(daemonName, args.image_base64)
          urlRef = url
        } else if (typeof args.image_url === 'string' && args.image_url.length > 0) {
          urlRef = args.image_url
        } else {
          return JSON.stringify({ ok: false, error: 'image_url or image_base64 required' })
        }
        const model = loadModel(daemonName)
        const photo: PagePhoto = { url: urlRef, caption, ts: Date.now() }
        model.gallery.unshift(photo)
        const { url: pageUrl } = saveModel(daemonName, model)
        return JSON.stringify({ ok: true, url: pageUrl, photo_url: urlRef, gallery: model.gallery.length })
      }

      case 'page_clear_section': {
        const heading = String(args.heading || '').trim().toLowerCase()
        if (!heading) return JSON.stringify({ ok: false, error: 'heading required' })
        const model = loadModel(daemonName)
        const before = model.sections.length
        model.sections = model.sections.filter(
          (s) => s.heading.toLowerCase() !== heading,
        )
        const removed = before - model.sections.length
        const { url } = saveModel(daemonName, model)
        return JSON.stringify({ ok: true, url, removed })
      }

      case 'page_reset': {
        const model = defaultModel(daemonName)
        const { url } = saveModel(daemonName, model)
        return JSON.stringify({ ok: true, url })
      }

      default:
        return `Error: unknown page tool: ${toolName}`
    }
  } catch (e) {
    return `Error in ${toolName}: ${e instanceof Error ? e.message : String(e)}`
  }
}
