/** Model-facing Phase 2 learning tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { TeachingCommandResult } from '@learn-dsh/teaching'

export const name = 'learn-dsh-tool-learning'
export const inject = ['tools', 'teaching', 'systemPrompt']

const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    checkId: { type: 'string', required: true },
    status: { type: 'string', required: true, enum: ['passed', 'failed', 'blocked'] },
    category: { type: 'string', required: true, enum: ['implementation', 'configuration', 'environment', 'safety'] },
    summary: { type: 'string', required: true },
    details: { type: 'array', required: true, items: { type: 'string' } },
    artifacts: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

const COMMAND_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      outcome: {
        type: 'string',
        required: true,
        enum: ['checkpoint-ready', 'exercise-ready', 'feedback-ready', 'retry-exercise', 'unit-completed'],
      },
      state_snapshot: { type: 'string', required: true },
      attempt: {
        type: 'object',
        additionalProperties: false,
        properties: {
          attemptId: { type: 'string', required: true },
          exerciseId: { type: 'string', required: true },
          unitId: { type: 'string', required: true },
          workspacePath: { type: 'string', required: true },
        },
      },
      checks: { type: 'array', items: CHECK_SCHEMA },
    },
  },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

function requireAgent(exec: { agent?: Agent }): Agent {
  if (exec.agent === undefined) throw new Error('learning tools require an owning agent session')
  return exec.agent
}

function commandValue(result: TeachingCommandResult) {
  return {
    outcome: result.outcome,
    state_snapshot: JSON.stringify(result.state),
    ...result.attempt === undefined ? {} : { attempt: result.attempt },
    ...result.checks === undefined ? {} : {
      checks: result.checks.map(check => ({ ...check, details: [...check.details], artifacts: [...check.artifacts] })),
    },
  }
}

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'learn-dsh:learning-tools',
    order: 115,
    text: 'Use learning_get_state before changing the lesson. Use learning_start_unit only for the deterministic recommended unit. Advance the active activity only through learning_complete_activity. Supply a stable command_id for every write and reuse it only when retrying the exact same operation. Never claim an exercise passed unless the returned checks are passed.',
  })

  ctx.tools.register(defineTool({
    name: 'learning_get_state',
    description: 'Read the committed long-term LearnerState bound to this Session. This is the source for the current plan and activity; do not infer newer state from prose.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { state_snapshot: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(_args, exec) {
      const agent = requireAgent(exec)
      return { state_snapshot: JSON.stringify(await ctx.teaching.stateFor(agent.id)) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'learning_start_unit',
    description: 'Start the deterministic next curriculum unit. On a new Enrollment, also establish the supplied learning goal and prerequisite-respecting plan. A different requested unit is rejected.',
    parameters: {
      command_id: { type: 'string', required: true, description: 'Stable idempotency key for this exact start operation.' },
      goal: { type: 'string', description: 'Required only while the Enrollment has no committed learning goal.' },
      unit_id: { type: 'string', description: 'Optional expected unit id; it must equal the deterministic recommendation.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { state_snapshot: { type: 'string', required: true } },
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      return { state_snapshot: JSON.stringify(await ctx.teaching.startUnit(agent.id, args.command_id, args.goal, args.unit_id)) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'learning_complete_activity',
    description: 'Complete the current deterministic teaching activity. Explain advances to a checkpoint; checkpoint records authored evidence and creates an isolated exercise; exercise runs versioned machine checks; feedback either retries the same attempt or completes the unit with machine evidence.',
    parameters: {
      command_id: { type: 'string', required: true, description: 'Stable idempotency key for this exact activity completion.' },
      summary: { type: 'string', required: true, description: 'Evidence-based reason or learner output summary for this transition.' },
    },
    output: COMMAND_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec)
      return commandValue(await ctx.teaching.completeActivity(agent.session, args.command_id, args.summary))
    },
  }))
}
