/** Model-facing diagnostic, planning, and teaching activity tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type { DiagnosticCommandResult, TeachingCommandResult } from '@learn-dsh/teaching'

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

function diagnosticValue(result: DiagnosticCommandResult) {
  return {
    state_snapshot: JSON.stringify(result.state),
    candidates: result.candidates.map(candidate => ({
      candidate_id: candidate.candidateId,
      unit_id: candidate.unitId,
      rubric_id: candidate.rubricId,
      objective: candidate.objective,
      criterion: candidate.criterion,
      allowed_evidence_kinds: [...candidate.allowedEvidenceKinds],
      sources: candidate.sources.map(source => ({
        path: source.path,
        version: source.version,
        anchor_kind: source.anchor.kind,
        anchor: source.anchor.value,
      })),
    })),
    waiver_eligibility: result.waiverEligibility.map(item => ({
      unit_id: item.unitId,
      eligible: item.eligible,
      evidence_ids: [...item.evidenceIds],
      blockers: [...item.blockers],
    })),
  }
}

const DIAGNOSTIC_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      state_snapshot: { type: 'string', required: true },
      candidates: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidate_id: { type: 'string', required: true },
            unit_id: { type: 'string', required: true },
            rubric_id: { type: 'string', required: true },
            objective: { type: 'string', required: true },
            criterion: { type: 'string', required: true },
            allowed_evidence_kinds: { type: 'array', required: true, items: { type: 'string' } },
            sources: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  path: { type: 'string', required: true },
                  version: { type: 'string', required: true },
                  anchor_kind: { type: 'string', required: true },
                  anchor: { type: 'string', required: true },
                },
              },
            },
          },
        },
      },
      waiver_eligibility: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            unit_id: { type: 'string', required: true },
            eligible: { type: 'boolean', required: true },
            evidence_ids: { type: 'array', required: true, items: { type: 'string' } },
            blockers: { type: 'array', required: true, items: { type: 'string' } },
          },
        },
      },
    },
  },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
} as const

export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: 'learn-dsh:learning-tools',
    order: 115,
    text: 'Use learning_get_state before changing the lesson. For a new Enrollment, collect the goal and background with learning_start_diagnostic, assess every returned curriculum-derived candidate, then submit them together. A waiver is only a displayed eligibility until the learner explicitly requests learning_waive_unit. Use learning_start_unit only for the deterministic recommended unit. Advance activities only through learning_complete_activity. Supply a stable command_id for every write and reuse it only when retrying the exact same operation. Never claim an exercise passed unless the returned checks are passed.',
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
    name: 'learning_start_diagnostic',
    description: 'Start a curriculum-derived diagnostic after collecting the learner goal, background, and target outcomes. Returns candidates built from unit objectives and required rubric rather than a fixed question list.',
    parameters: {
      command_id: { type: 'string', required: true, description: 'Stable idempotency key for this exact diagnostic start.' },
      goal: { type: 'string', required: true },
      background: { type: 'string', required: true },
      target_outcome_ids: { type: 'array', items: { type: 'string' }, description: 'Defaults to all course learning outcomes.' },
    },
    output: DIAGNOSTIC_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec)
      return diagnosticValue(await ctx.teaching.startDiagnostic(agent.id, args.command_id, args.goal, args.background, args.target_outcome_ids))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'learning_submit_diagnostic',
    description: 'Submit one meets, gap, or uncertain assessment for every returned diagnostic candidate. Meets evidence must use an allowed kind; observed evidence must cite an exact returned curriculum source, and machine evidence must cite committed machine evidence for the same unit.',
    parameters: {
      command_id: { type: 'string', required: true },
      assessments: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            candidate_id: { type: 'string', required: true },
            status: { type: 'string', required: true, enum: ['meets', 'gap', 'uncertain'] },
            summary: { type: 'string', required: true },
            evidence_kind: { type: 'string', enum: ['authored', 'machine', 'observed'] },
            source_path: { type: 'string' },
            source_anchor_kind: { type: 'string' },
            source_anchor: { type: 'string' },
            existing_evidence_id: { type: 'string' },
          },
        },
      },
    },
    output: DIAGNOSTIC_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec)
      return diagnosticValue(await ctx.teaching.submitDiagnostic(agent.id, args.command_id, args.assessments.map(assessment => ({
        candidateId: assessment.candidate_id,
        status: assessment.status,
        summary: assessment.summary,
        ...(assessment.evidence_kind === undefined ? {} : { evidenceKind: assessment.evidence_kind }),
        ...(assessment.source_path === undefined ? {} : { sourcePath: assessment.source_path }),
        ...(assessment.source_anchor_kind === undefined ? {} : { sourceAnchorKind: assessment.source_anchor_kind }),
        ...(assessment.source_anchor === undefined ? {} : { sourceAnchor: assessment.source_anchor }),
        ...(assessment.existing_evidence_id === undefined ? {} : { existingEvidenceId: assessment.existing_evidence_id }),
      }))))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'learning_waive_unit',
    description: 'Waive one unit only after the learner explicitly requests it and the completed diagnostic proves every required rubric with at least one observed or machine evidence item. Waived is distinct from exercise-completed.',
    parameters: {
      command_id: { type: 'string', required: true },
      unit_id: { type: 'string', required: true },
      reason: { type: 'string', required: true },
    },
    output: DIAGNOSTIC_OUTPUT,
    async execute(args, exec) {
      const agent = requireAgent(exec)
      return diagnosticValue(await ctx.teaching.waiveUnit(agent.id, args.command_id, args.unit_id, args.reason))
    },
  }))

  ctx.tools.register(defineTool({
    name: 'learning_adjust_plan',
    description: 'Apply a learner-requested plan adjustment while preserving all incomplete target-path units and prerequisite order. The persisted reason is linked to diagnostic evidence.',
    parameters: {
      command_id: { type: 'string', required: true },
      unit_ids: { type: 'array', required: true, items: { type: 'string' } },
      reason: { type: 'string', required: true },
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
      return { state_snapshot: JSON.stringify(await ctx.teaching.adjustPlan(agent.id, args.command_id, args.unit_ids, args.reason)) }
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
