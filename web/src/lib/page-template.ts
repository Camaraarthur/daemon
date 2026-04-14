/**
 * Default page template for <daemon_name>.daemon.page.
 *
 * Renders a polished single-page HTML from a page model managed by the
 * page_* agent tools (see page-tools.ts). The model lives in
 * data/sites/<daemon_name>/page.json; this function takes it and
 * produces the static index.html.
 *
 * Design constraints:
 *   - Fully self-contained: no external fonts, no CDN links, no JS
 *     required for correctness. Works offline / in an airgapped tunnel.
 *   - Dark theme to match /canvas: bg #0a0a0a, fg #f5f5f5, accent #7c3aed.
 *   - Auto-refresh every 30s via <meta http-equiv="refresh"> so a demo
 *     audience sees updates without touching the page.
 */

export interface PageSection {
  heading: string
  body_html: string
  ts: number // unix ms
}

export interface PagePhoto {
  url: string
  caption?: string
  ts: number
}

export interface PageModel {
  title?: string
  tagline?: string
  sections: PageSection[]
  gallery: PagePhoto[]
  daemon_name: string
  updated_at?: number
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatTs(ms: number): string {
  try {
    const d = new Date(ms)
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
  } catch {
    return ''
  }
}

export function renderIndexHtml(model: PageModel): string {
  const daemonName = model.daemon_name || 'daemon'
  const title = model.title || daemonName
  const tagline = model.tagline || 'my daemon'
  const sections = model.sections || []
  const gallery = model.gallery || []
  const updated = model.updated_at || Date.now()

  const sectionHtml = sections
    .map((s) => {
      const heading = escapeHtml(s.heading || '')
      // body_html is trusted — the agent is the author of its own page.
      // We still refuse <script> in the template to reduce foot-guns, by
      // stripping via a simple regex (not a full sanitizer).
      const body = String(s.body_html || '').replace(
        /<script[\s\S]*?<\/script>/gi,
        '',
      )
      const ts = s.ts ? formatTs(s.ts) : ''
      return `        <section class="card">
          <header>
            <h2>${heading}</h2>
            ${ts ? `<time>${ts}</time>` : ''}
          </header>
          <div class="body">${body}</div>
        </section>`
    })
    .join('\n')

  const galleryHtml = gallery.length
    ? `        <section class="card gallery-card">
          <header><h2>gallery</h2></header>
          <div class="gallery">
${gallery
  .map(
    (p) => `            <figure>
              <img src="${escapeHtml(p.url)}" alt="${escapeHtml(p.caption || '')}" loading="lazy" />
              ${p.caption ? `<figcaption>${escapeHtml(p.caption)}</figcaption>` : ''}
            </figure>`,
  )
  .join('\n')}
          </div>
        </section>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="30" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0a0a0a;
      --fg: #f5f5f5;
      --dim: #888;
      --card: #141414;
      --border: #1f1f1f;
      --accent: #7c3aed;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI',
        Roboto, Helvetica, Arial, sans-serif;
      font-size: 16px;
      line-height: 1.6;
      min-height: 100vh;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; }
    header.hero {
      margin-bottom: 48px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 32px;
    }
    header.hero h1 {
      margin: 0 0 8px 0;
      font-size: 40px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    header.hero p.tagline {
      margin: 0;
      color: var(--dim);
      font-size: 18px;
    }
    .live {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--dim);
      margin-top: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .live .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.7);
      animation: pulse 1.6s ease-out infinite;
    }
    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0.7); }
      70% { box-shadow: 0 0 0 10px rgba(124, 58, 237, 0); }
      100% { box-shadow: 0 0 0 0 rgba(124, 58, 237, 0); }
    }
    main { display: flex; flex-direction: column; gap: 20px; }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
    }
    .card header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 12px;
    }
    .card h2 { margin: 0; font-size: 20px; font-weight: 600; }
    .card time { color: var(--dim); font-size: 12px; font-variant-numeric: tabular-nums; }
    .card .body { color: var(--fg); }
    .card .body p { margin: 0 0 12px 0; }
    .card .body p:last-child { margin-bottom: 0; }
    .card .body img { max-width: 100%; border-radius: 8px; }
    .card .body ul, .card .body ol { margin: 0; padding-left: 20px; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
    .gallery figure { margin: 0; }
    .gallery img {
      width: 100%;
      aspect-ratio: 1;
      object-fit: cover;
      border-radius: 8px;
      display: block;
      background: #000;
    }
    .gallery figcaption { color: var(--dim); font-size: 12px; margin-top: 6px; }
    footer.site-foot {
      margin-top: 64px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      color: var(--dim);
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }
    footer.site-foot a { color: var(--dim); }
    .empty { color: var(--dim); font-style: italic; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="hero">
      <h1>${escapeHtml(title)}</h1>
      <p class="tagline">${escapeHtml(tagline)}</p>
      <div class="live" title="page auto-refreshes every 30s"><span class="dot"></span> live</div>
    </header>
    <main>
${sectionHtml || '      <p class="empty">nothing here yet. the daemon will post soon.</p>'}
${galleryHtml}
    </main>
    <footer class="site-foot">
      <span>powered by <a href="https://daemon.page">daemon</a> &middot; ${escapeHtml(daemonName)}</span>
      <span>updated ${formatTs(updated)}</span>
    </footer>
  </div>
</body>
</html>
`
}
