/**
 * POST /api/schedule/fire
 *
 * The device's scheduler tick (cli/scheduler.mjs) calls this when a
 * schedule is due. We authenticate via the device_token Bearer header,
 * then run the agent loop with the schedule's prompt as a fresh user
 * message in the schedule's tagged thread. The result is streamed via
 * the StreamingWriter so any subscribed browser sees it live, AND
 * gossiped back to the user's daemon devices so it lands in their
 * local chat_messages table.
 *
 * No SSE response — this is a fire-and-forget POST. The endpoint
 * returns 202 immediately and runs the agent in the background. The
 * device only cares whether it was accepted; results land via gossip.
 *
 * Vision §3.3.
 */

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import {
  validateDeviceToken,
  createThread,
  getThread,
} from '@/lib/db'
import { runAgentLoopStreaming } from '@/lib/agent-loop-streaming'
import { StreamingWriter } from '@/lib/streaming-writer'
import { PROVIDERS } from '@/lib/model-router'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface FireBody {
  device_id?: string
  schedule_name?: string
  prompt?: string
  thread_id?: string | null
  project_id?: number | null
}

function getProviderConfig(tier: 'free' | 'mid') {
  const provider = PROVIDERS[tier]
  return {
    baseUrl: provider.baseUrl,
    model: tier === 'free' ? 'qwen/qwen3-coder' : provider.model,
    apiKey: provider.getApiKey(),
    extraHeaders: provider.extraHeaders as Record<string, string>,
    maxTokens: provider.maxTokens,
  }
}

export async function POST(req: NextRequest) {
  // ── Auth: Bearer device_token ───────────────────────────
  const auth = req.headers.get('authorization') || ''
  const m = auth.match(/^Bearer\s+(.+)$/i)
  if (!m) {
    return NextResponse.json({ error: 'missing bearer token' }, { status: 401 })
  }
  const tokenInfo = validateDeviceToken(m[1])
  if (!tokenInfo) {
    return NextResponse.json({ error: 'invalid device_token' }, { status: 401 })
  }
  const { userId, deviceId } = tokenInfo

  // ── Parse body ──────────────────────────────────────────
  let body: FireBody
  try {
    body = (await req.json()) as FireBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const scheduleName = body.schedule_name?.trim()
  const prompt = body.prompt?.trim()
  if (!scheduleName || !prompt) {
    return NextResponse.json(
      { error: 'schedule_name and prompt are required' },
      { status: 400 },
    )
  }
  if (prompt.length > 4000) {
    return NextResponse.json({ error: 'prompt too long (max 4000)' }, { status: 400 })
  }

  // The device may have sanity-checked deviceId mismatch — log only,
  // don't reject (the token's deviceId is the source of truth).
  if (body.device_id && body.device_id !== deviceId) {
    console.warn(
      `[schedule/fire] device_id mismatch: token=${deviceId} body=${body.device_id}`,
    )
  }

  // ── Resolve / create thread ─────────────────────────────
  // If the schedule has no thread, create one tagged with the schedule
  // name. The next firing reuses the same thread, so the user gets a
  // single ongoing conversation per schedule.
  let threadId = body.thread_id || null
  if (threadId) {
    const t = getThread(threadId)
    if (!t || t.user_id !== userId) {
      // Schedule's thread is gone or doesn't belong to this user — fall
      // back to creating a fresh one rather than 404'ing.
      threadId = null
    }
  }
  if (!threadId) {
    const fresh = createThread(
      userId,
      body.project_id || undefined,
      `[schedule] ${scheduleName}`,
    )
    threadId = fresh.id
  }

  // ── Fire-and-forget agent run ───────────────────────────
  // Return 202 immediately; the agent loop runs in the background and
  // streams its output via gossip + WS broadcast. We don't await.
  const runId = randomUUID()
  const sourceSessionId = `schedule:${scheduleName}:${runId.slice(0, 8)}`

  // Kick off async work without holding the request open. We swallow
  // errors here — the schedule's last_error is recorded by the device
  // when our HTTP response comes back, but a background agent failure
  // also logs to stderr for the operator.
  ;(async () => {
    try {
      const writer = new StreamingWriter({
        threadId: threadId!,
        role: 'assistant',
        sourceSessionId,
        sseSend: () => {}, // no SSE client; events still broadcast + gossip
        userId,
        projectId: body.project_id || null,
      })

      // Inject the schedule prompt as a user message via gossip + broadcast
      // so the user sees the question that triggered the run, not just the
      // answer. This mirrors how chat/route.ts persists the inbound message.
      const userMsgWriter = new StreamingWriter({
        threadId: threadId!,
        role: 'user',
        sourceSessionId,
        sseSend: () => {},
        userId,
        projectId: body.project_id || null,
      })
      userMsgWriter.handleEvent({ type: 'token', data: { text: prompt } } as any)
      userMsgWriter.finalize({ content: prompt, model: undefined, toolCalls: [] })

      const providerConfig = getProviderConfig('free')
      const systemPrompt = `You are running as a scheduled task named "${scheduleName}" on the user's daemon. Respond concisely with the requested information.`

      const result = await runAgentLoopStreaming({
        provider: providerConfig,
        systemPrompt,
        userMessage: prompt,
        userId: String(userId),
        maxIterations: 10,
        onEvent: writer.handleEvent,
        history: [],
        conversationId: threadId!,
        projectId: body.project_id || undefined,
      })

      writer.finalize({
        content: result.response,
        model: result.model,
        toolCalls: result.toolCalls,
      })
      console.log(
        `[schedule/fire] ${scheduleName} done (user=${userId} thread=${threadId} model=${result.model})`,
      )
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[schedule/fire] ${scheduleName} failed:`, msg)
    }
  })()

  return NextResponse.json(
    { ok: true, accepted: true, schedule_name: scheduleName, thread_id: threadId, run_id: runId },
    { status: 202 },
  )
}
