/**
 * Agent-callable tools for the scheduler primitive (vision.md §3.3).
 *
 * The agent calls schedule() to register a recurring task. When the
 * cron fires, the device pings /api/schedule/fire and a fresh agent
 * loop runs with the schedule's prompt as a user message in the tagged
 * thread. Result lands as a chat message via gossip.
 *
 * Wired into agent-loop.ts the same way memory-tools and secrets-tools
 * are: SCHEDULE_TOOL_NAMES routes dispatch, IDEMPOTENT_SCHEDULE_TOOLS
 * lets reads parallelize.
 */

import {
  createSchedule,
  listSchedules,
  deleteSchedule,
  setScheduleEnabled,
} from './device-schedules'

export interface ScheduleToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export const SCHEDULE_TOOLS: ScheduleToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'schedule',
      description:
        'Register a recurring task. Every time the cron fires, daemon will run a fresh agent loop with the given prompt as a user message in the current chat thread (or a new thread tagged with the schedule name). Use for "every morning at 8 summarize my emails", "check the deploy every 5 minutes", "weekly digest of my notes". The cron is a standard 5-field UTC expression: "minute hour day-of-month month day-of-week". Examples: "0 8 * * *" (8am UTC every day), "*/30 * * * *" (every 30 minutes), "0 9 * * 1-5" (9am UTC Mon-Fri).',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Short stable identifier for the schedule (snake_case, e.g. "morning_briefing"). Reusing the same name updates the existing schedule in place.',
          },
          cron: {
            type: 'string',
            description: '5-field cron expression in UTC. NO seconds, NO @reboot, NO timezone.',
          },
          prompt: {
            type: 'string',
            description: 'The instruction the agent will receive when the schedule fires. Treat it like a fresh user message — be specific and self-contained.',
          },
        },
        required: ['name', 'cron', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_schedules',
      description:
        'List every recurring task registered for this user. Returns name, cron, prompt, last run time, next run time, run count, and enabled state. Use this to check what is already scheduled before creating new ones.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_schedule',
      description: 'Permanently delete a scheduled task by name. Use pause_schedule instead if the user wants to keep the definition but stop firing.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The schedule name to delete.' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'pause_schedule',
      description: 'Disable a schedule without deleting it. The next_run_at stays computed but the tick loop skips it. Use resume_schedule to re-enable.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'resume_schedule',
      description: 'Re-enable a previously paused schedule.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
]

export const SCHEDULE_TOOL_NAMES = new Set(SCHEDULE_TOOLS.map((t) => t.function.name))

/** list_schedules is the only safely-parallelizable schedule tool. */
export const IDEMPOTENT_SCHEDULE_TOOLS = new Set(['list_schedules'])

export async function executeScheduleTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { userId: number; threadId?: string | null; projectId?: number | null },
): Promise<string> {
  if (!ctx.userId) return 'Error: schedule tools require a user context.'
  try {
    switch (toolName) {
      case 'schedule': {
        const r = await createSchedule({
          userId: ctx.userId,
          name: String(args.name || ''),
          cron: String(args.cron || ''),
          prompt: String(args.prompt || ''),
          // Default to the current chat thread so the user sees the
          // scheduled run alongside the conversation that created it.
          threadId: ctx.threadId || null,
          projectId: ctx.projectId || null,
        })
        if (!r.ok) return JSON.stringify({ ok: false, error: r.error })
        return JSON.stringify({
          ok: true,
          name: String(args.name),
          next_run_at: r.nextRunAt,
        })
      }

      case 'list_schedules': {
        const r = await listSchedules({ userId: ctx.userId })
        if (!r.ok) return `Error: ${r.error || 'list_schedules failed'}`
        return JSON.stringify({
          ok: true,
          count: r.schedules.length,
          schedules: r.schedules.map((s) => ({
            name: s.name,
            cron: s.cron,
            prompt: s.prompt,
            enabled: s.enabled,
            last_run_at: s.last_run_at,
            next_run_at: s.next_run_at,
            run_count: s.run_count,
            last_error: s.last_error,
          })),
        })
      }

      case 'cancel_schedule': {
        const r = await deleteSchedule({
          userId: ctx.userId,
          name: String(args.name || ''),
        })
        if (!r.ok) return `Error: ${r.error || 'cancel_schedule failed'}`
        return JSON.stringify({ ok: true, removed: r.removed })
      }

      case 'pause_schedule':
      case 'resume_schedule': {
        const r = await setScheduleEnabled({
          userId: ctx.userId,
          name: String(args.name || ''),
          enabled: toolName === 'resume_schedule',
        })
        if (!r.ok) return `Error: ${r.error || `${toolName} failed`}`
        return JSON.stringify({ ok: true })
      }

      default:
        return `Error: unknown schedule tool: ${toolName}`
    }
  } catch (e) {
    return `Error in ${toolName}: ${e instanceof Error ? e.message : String(e)}`
  }
}
