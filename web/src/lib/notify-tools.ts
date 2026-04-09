/**
 * Agent-callable notification tool (vision §3.4).
 *
 * The agent calls notify({title, body, url?}) when it has something
 * worth interrupting the user for: a scheduled run finished, a watcher
 * tripped, a long task completed, an alert needs human attention.
 *
 * Routing: directly to web-push (no device hop). Push subscriptions
 * live on the relay because notifications must be deliverable while
 * the user's daemon device is asleep.
 *
 * Future v1.5: native iOS/Android push via APNs/FCM. The tool surface
 * stays the same — the relay picks the best channel.
 */

import { sendNotificationToUser } from './web-push'

export interface NotifyToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const NOTIFY_TOOLS: NotifyToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'notify',
      description:
        'Send a native notification to the user. Use this when something deserves the user\'s attention right now: a scheduled run produced a result, a watcher detected a change, a long-running task completed, an alert needs them to act. Be sparing — every notification interrupts the user. Title and body are short. Optionally include a url that opens when the user clicks the notification.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Notification headline. Keep under 50 characters.',
          },
          body: {
            type: 'string',
            description: 'One to three sentences of detail. Keep under 200 characters.',
          },
          url: {
            type: 'string',
            description: 'Optional URL to open when the user clicks the notification. Defaults to the daemon homepage.',
          },
          tag: {
            type: 'string',
            description: 'Optional dedupe tag — consecutive notifications with the same tag replace each other instead of stacking.',
          },
        },
        required: ['title', 'body'],
      },
    },
  },
]

export const NOTIFY_TOOL_NAMES = new Set(NOTIFY_TOOLS.map((t) => t.function.name))

export async function executeNotifyTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { userId: number },
): Promise<string> {
  if (!ctx.userId) return 'Error: notify requires a user context.'
  if (toolName !== 'notify') return `Error: unknown notify tool: ${toolName}`
  try {
    const r = await sendNotificationToUser(ctx.userId, {
      title: String(args.title || ''),
      body: String(args.body || ''),
      url: typeof args.url === 'string' ? args.url : undefined,
      tag: typeof args.tag === 'string' ? args.tag : undefined,
    })
    if (r.sent === 0 && r.failed === 0) {
      return JSON.stringify({
        ok: false,
        error: 'no push subscriptions registered for this user — open the daemon web app and enable notifications first',
      })
    }
    return JSON.stringify({
      ok: true,
      sent: r.sent,
      failed: r.failed,
      removed: r.removed,
    })
  } catch (e) {
    return `Error in notify: ${e instanceof Error ? e.message : String(e)}`
  }
}
