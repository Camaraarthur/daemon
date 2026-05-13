import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, getUserId } from '@/lib/auth'

/**
 * POST /api/voice/hover — receive a WAV utterance from the phone's
 * hover-mic overlay, run Deepgram STT, then fan the transcript into
 * the existing /api/voice/command pipeline with source="hover" so the
 * agent treats it as a voice command.
 *
 * Multipart form body:
 *   - audio:       WAV file (16kHz mono PCM16 from HoverMicService)
 *   - duration_ms: string — how long the user held the button
 *   - device_id:   string — phone model or hostname
 *   - source:      "hover"
 *
 * Why server-side STT (not phone-side): keeps the Deepgram API key in
 * vault.env, not in the APK. Reuses the relay's auth + dispatch paths
 * identically to the pendant voice path — the companion just ships raw
 * audio and the server decides what happens next.
 */

const DEEPGRAM_URL = 'https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true'

export async function POST(req: NextRequest) {
  const unauth = requireAuth(req)
  if (unauth) return unauth

  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const deepgramKey = process.env.DEEPGRAM_API_KEY
  if (!deepgramKey) {
    return NextResponse.json({ error: 'DEEPGRAM_API_KEY not set on relay' }, { status: 500 })
  }

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'expected multipart/form-data' }, { status: 400 })
  const audio = form.get('audio')
  if (!(audio instanceof Blob)) return NextResponse.json({ error: 'missing audio blob' }, { status: 400 })
  const deviceId = String(form.get('device_id') || 'phone')
  const durationMs = Number(form.get('duration_ms') || 0)

  // STT round-trip
  const wavBytes = Buffer.from(await audio.arrayBuffer())
  let transcript = ''
  try {
    const dgRes = await fetch(DEEPGRAM_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${deepgramKey}`,
        'Content-Type': 'audio/wav',
      },
      body: wavBytes,
    })
    if (!dgRes.ok) {
      const body = await dgRes.text()
      return NextResponse.json({ error: `Deepgram returned ${dgRes.status}`, detail: body.slice(0, 400) }, { status: 502 })
    }
    const dg: any = await dgRes.json()
    transcript = String(dg?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim()
  } catch (e: any) {
    return NextResponse.json({ error: 'Deepgram failed', detail: String(e?.message || e) }, { status: 502 })
  }

  if (!transcript) {
    return NextResponse.json({ ok: true, transcript: '', skipped: 'empty transcript' })
  }

  // Dispatch into the existing pendant/voice pipeline. Use loopback
  // explicitly — the earlier `new URL(req.url)` resolved to my.daemon.page
  // (Cloudflare-fronted) and the inner fetch flaked under the proxy.
  // 127.0.0.1:4802 is the Next.js process itself; the proxy at :4800
  // delegates here. Either works; loopback is more predictable.
  const cookie = req.headers.get('cookie') || ''
  const localUrl = `http://127.0.0.1:${process.env.PORT || '4800'}/api/voice/command`
  try {
    const dispatchRes = await fetch(localUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ transcript, source: 'hover', device_id: deviceId }),
    })
    const dispatch = await dispatchRes.json().catch(() => ({}))
    return NextResponse.json({ ok: true, transcript, duration_ms: durationMs, dispatch })
  } catch (e: any) {
    return NextResponse.json({ ok: false, transcript, error: `dispatch failed: ${e?.message || e}` }, { status: 500 })
  }
}
