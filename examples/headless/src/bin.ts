#!/usr/bin/env node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import {
  ToolCallId,
  LlmAdapter,
  createUserMessage,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type Message,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import { EnrollmentId, LearnerId, type LearnerState } from '@learn-dsh/learner'
import type {} from '@learn-dsh/lab/local'
import type {} from '@learn-dsh/teacher'
import type {} from '@learn-dsh/teaching'
import type {} from '@learn-dsh/tool-learning'
import { bootHeadlessProfile } from './profile.js'

const LEARNER_CONTEXT_NAME = 'learn-dsh:learner-state'
const RUNTIME_CONTEXT_PLUGIN = '@deepseek-ai/dsh-system-prompt'

interface ScriptEntry {
  readonly label: string
  readonly chunks: readonly StreamChunk[]
}

interface CapturedRequest {
  readonly label: string
  readonly learnerSnapshot: string
}

function textResponse(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

function toolCallResponse(rawCallId: string, name: string, args: object, text?: string): StreamChunk[] {
  const id = ToolCallId(rawCallId)
  const argumentsJson = JSON.stringify(args)
  const chunks: StreamChunk[] = []
  let index = 0
  if (text !== undefined) {
    chunks.push(
      { type: 'block-start', index, blockType: 'text' },
      { type: 'text-delta', index, text },
      { type: 'block-end', index, block: { type: 'text', text } },
    )
    index += 1
  }
  chunks.push(
    { type: 'block-start', index, blockType: 'tool-call' },
    { type: 'tool-call-delta', index, id, name, argumentsDelta: argumentsJson },
    { type: 'block-end', index, block: { type: 'tool-call', id, name, arguments: argumentsJson } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  )
  return chunks
}

function learnerSection(message: Message): string | undefined {
  const source = message.source
  if (source.kind !== 'plugin' || source.form !== 'snapshot') return undefined
  return source.sections.find(section => section.name === LEARNER_CONTEXT_NAME)?.text
}

function messageText(message: Message): string {
  return message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

function currentLearnerSnapshot(messages: readonly Message[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = learnerSection(messages[index]!)
    if (text !== undefined) return text
  }
  throw new Error('scripted model request did not contain a LearnerState runtime-context snapshot')
}

class SnapshotAdapter extends LlmAdapter {
  readonly requests: CapturedRequest[] = []

  constructor(private readonly script: ScriptEntry[]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const entry = this.script.shift()
    if (entry === undefined) throw new Error('SnapshotAdapter script exhausted')
    this.requests.push({ label: entry.label, learnerSnapshot: currentLearnerSnapshot(options.messages) })
    for (const chunk of entry.chunks) yield chunk
  }
}

function parseState(snapshot: string): LearnerState {
  const delimiter = snapshot.indexOf('\n')
  if (delimiter < 0) throw new Error('LearnerState snapshot is missing its JSON payload')
  return JSON.parse(snapshot.slice(delimiter + 1)) as LearnerState
}

function snapshotSections(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event => {
    if (event.type !== 'user/message') return []
    const source = event.data.source
    if (source.kind !== 'plugin' || source.plugin !== RUNTIME_CONTEXT_PLUGIN || source.form !== 'snapshot') return []
    const section = source.sections.find(candidate => candidate.name === LEARNER_CONTEXT_NAME)
    return section === undefined ? [] : [section.text]
  })
}

function summarizeRequest(request: CapturedRequest, sessionSnapshots: readonly string[]) {
  const state = parseState(request.learnerSnapshot)
  const checks = Object.values(state.attempts).flatMap(attempt => attempt.checks.map(check => ({
    checkId: check.checkId,
    status: check.status,
    category: check.category,
  })))
  const hints = Object.values(state.attempts).flatMap(attempt => attempt.hintLevels.map(level => ({
    attemptId: attempt.attemptId,
    level,
  })))
  return {
    label: request.label,
    activity: state.currentActivity === null ? null : {
      kind: state.currentActivity.kind,
      ...'unitId' in state.currentActivity ? { unitId: state.currentActivity.unitId } : {},
      ...'attemptId' in state.currentActivity && state.currentActivity.attemptId !== undefined
        ? { attemptId: state.currentActivity.attemptId }
        : {},
    },
    completedUnits: Object.entries(state.unitProgress)
      .filter(([, progress]) => progress === 'completed')
      .map(([unitId]) => unitId),
    skippedUnits: Object.entries(state.unitProgress)
      .filter(([, progress]) => progress === 'skipped')
      .map(([unitId]) => unitId),
    checks,
    hints,
    exactSnapshotInSessionLog: sessionSnapshots.includes(request.learnerSnapshot),
  }
}

function summarizeState(state: LearnerState) {
  return {
    learnerId: state.learnerId,
    enrollmentId: state.enrollmentId,
    courseId: state.courseId,
    goal: state.goal,
    diagnostic: state.diagnostic,
    activePlan: state.activePlan,
    currentActivity: state.currentActivity,
    unitProgress: state.unitProgress,
    attempts: Object.values(state.attempts).map(attempt => ({
      attemptId: attempt.attemptId,
      exerciseId: attempt.exerciseId,
      unitId: attempt.unitId,
      checks: attempt.checks,
      hintLevels: attempt.hintLevels,
    })),
    evidence: Object.values(state.evidence).map(evidence => ({
      kind: evidence.kind,
      summary: evidence.summary,
      unitId: evidence.unitId,
      ...evidence.attemptId === undefined ? {} : { attemptId: evidence.attemptId },
    })),
    mastery: state.mastery,
    nextRecommendation: state.nextRecommendation,
    courseCompleted: state.courseCompleted,
    sourceSessionIds: state.sourceSessionIds,
    lastSeq: state.lastSeq,
  }
}

async function followup(handle: AgentHandle, text: string): Promise<void> {
  handle.agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }))
  await handle.agent.whenIdle()
}

const script: ScriptEntry[] = [
  {
    label: 'first-entry',
    chunks: textResponse('I teach DSH through source-backed explanation, learner checkpoints, sandboxed exercises, and machine evidence. I only use capabilities allowed by this profile, and I will not claim completion without persisted evidence.'),
  },
  { label: 'state-read', chunks: toolCallResponse('state-1', 'learning_get_state', {}) },
  {
    label: 'novice-diagnostic-start',
    chunks: toolCallResponse('diagnostic-start-1', 'learning_start_diagnostic', {
      command_id: 'phase-3-novice-diagnostic-start',
      goal: 'Understand DSH plugin composition through real source and machine evidence',
      background: 'TypeScript developer new to DSH and Cordis',
      target_outcome_ids: [
        'plugin-context-service-effect',
        'profile-bundle-preset-plugin',
        'service-provider-consumer',
        'prompt-tool-loop-session',
        'minimal-plugin-lifecycle',
        'callable-tool-tested',
        'replace-minimal-provider',
        'compose-bundle-profile',
      ],
    }),
  },
  {
    label: 'novice-diagnostic-submit',
    chunks: toolCallResponse('diagnostic-submit-1', 'learning_submit_diagnostic', {
      command_id: 'phase-3-novice-diagnostic-submit',
      assessments: [
        {
          candidate_id: 'diagnostic-plugin-context-service-effect-names-roles',
          status: 'gap',
          summary: 'The learner does not yet distinguish Service Definitions from Providers.',
        },
        {
          candidate_id: 'diagnostic-plugin-context-service-effect-traces-disposal',
          status: 'meets',
          summary: 'The learner located Context ownership in the locked DSH source but still needs the full role model.',
          evidence_kind: 'observed',
          source_path: 'vendor/cordis/src/context.ts',
          source_anchor_kind: 'export',
          source_anchor: 'Context',
        },
        {
          candidate_id: 'diagnostic-capability-seam-explains-seam-roles',
          status: 'gap',
          summary: 'The learner does not yet distinguish Definition, Provider, and Consumer.',
        },
        {
          candidate_id: 'diagnostic-capability-seam-implements-provider',
          status: 'uncertain',
          summary: 'The learner has not implemented a replaceable Provider.',
        },
        {
          candidate_id: 'diagnostic-model-callable-tool-traces-tool-loop',
          status: 'gap',
          summary: 'The learner cannot yet trace Tool Schema through Agent Loop and Session Log.',
        },
        {
          candidate_id: 'diagnostic-model-callable-tool-implements-callable-tool',
          status: 'uncertain',
          summary: 'The learner has not built a model-callable DSH Tool.',
        },
        {
          candidate_id: 'diagnostic-bundle-profile-composition-distinguishes-composition-units',
          status: 'gap',
          summary: 'The learner confuses Profile, Bundle, Preset, and Plugin ownership.',
        },
        {
          candidate_id: 'diagnostic-bundle-profile-composition-validates-bundle',
          status: 'uncertain',
          summary: 'The learner has not composed and validated a DSH bundle.',
        },
      ],
    }),
  },
  {
    label: 'start-unit',
    chunks: toolCallResponse('start-1', 'learning_start_unit', {
      command_id: 'phase-2-start-unit',
      goal: 'Understand DSH plugin composition through real source and machine evidence',
      unit_id: 'plugin-context-service-effect',
    }),
  },
  {
    label: 'explain',
    chunks: toolCallResponse('explain-1', 'learning_complete_activity', {
      command_id: 'phase-2-complete-explain',
      summary: 'The lesson objective and source-backed lifecycle explanation were presented.',
    }, 'Objective: explain how Plugin, Context, Service, typed events, and Effect disposal compose. Completion requires your own lifecycle trace plus a passed machine check. At DSH 0.1.2-rc.1 / a66e47020478, docs/architecture.md establishes the Cordis plugin tree, vendor/cordis/src/context.ts defines the scoped Context, and vendor/cordis/src/service.ts defines replaceable Service capabilities. A plugin receives its Context, registers services or typed-event coordination through that scope, and binds cleanup to its fiber with Effects/disposers.'),
  },
  {
    label: 'checkpoint-prompt',
    chunks: textResponse('Checkpoint: in your own words, trace plugin fiber → Context → Service or typed-event registration → Effect/disposer, and explain what disappears when the fiber is disposed.'),
  },
  {
    label: 'checkpoint-answer',
    chunks: toolCallResponse('checkpoint-1', 'learning_complete_activity', {
      command_id: 'phase-2-complete-checkpoint',
      summary: 'The learner traced Context ownership, Service registration, typed events, and Effect disposal.',
    }),
  },
  { label: 'hint-level-1', chunks: toolCallResponse('hint-1', 'learning_request_hint', { command_id: 'phase-4-hint-level-1' }) },
  { label: 'hint-level-2', chunks: toolCallResponse('hint-2', 'learning_request_hint', { command_id: 'phase-4-hint-level-2' }) },
  { label: 'hint-level-3', chunks: toolCallResponse('hint-3', 'learning_request_hint', { command_id: 'phase-4-hint-level-3' }) },
  {
    label: 'exercise-before-failure',
    chunks: toolCallResponse('check-fail-1', 'learning_complete_activity', {
      command_id: 'phase-2-check-failure',
      summary: 'Run the deterministic exercise check before the learner edits the fixture.',
    }),
  },
  {
    label: 'failed-check',
    chunks: toolCallResponse('feedback-fail-1', 'learning_complete_activity', {
      command_id: 'phase-2-feedback-failure',
      summary: 'The check reports an incomplete lifecycle trace, so retain the same attempt for revision.',
    }, 'Machine check failed in the implementation category: answer.json is incomplete. Revise the missing lifecycle fields and source citations in this same attempt; no mastery or completion has been granted.'),
  },
  { label: 'retry-ready', chunks: textResponse('The same exercise attempt is ready for revision.') },
  {
    label: 'exercise-before-success',
    chunks: toolCallResponse('check-pass-1', 'learning_complete_activity', {
      command_id: 'phase-2-check-success',
      summary: 'Run the deterministic exercise check after the learner revised the artifact.',
    }),
  },
  {
    label: 'successful-check',
    chunks: toolCallResponse('feedback-pass-1', 'learning_complete_activity', {
      command_id: 'phase-2-feedback-success',
      summary: 'The authored explanation and machine evidence jointly support unit completion.',
    }, 'Machine check passed: answer.json now contains every required lifecycle field and at least two valid curriculum source citations. This machine evidence can now support mastery together with your authored checkpoint.'),
  },
  { label: 'unit-completed', chunks: textResponse('The unit is complete with persisted machine evidence.') },
  { label: 'original-session-resume', chunks: textResponse('The original Session resumed from the committed state.') },
  { label: 'new-session-continuity', chunks: textResponse('A new Session continued the same Enrollment state.') },
  {
    label: 'experienced-diagnostic-start',
    chunks: toolCallResponse('experienced-diagnostic-start-1', 'learning_start_diagnostic', {
      command_id: 'phase-3-experienced-diagnostic-start',
      goal: 'Contribute a DSH bundle while skipping concepts already demonstrated',
      background: 'Experienced Cordis plugin developer who has shipped scoped services',
      target_outcome_ids: [
        'plugin-context-service-effect',
        'profile-bundle-preset-plugin',
        'service-provider-consumer',
        'prompt-tool-loop-session',
        'minimal-plugin-lifecycle',
        'callable-tool-tested',
        'replace-minimal-provider',
        'compose-bundle-profile',
      ],
    }),
  },
  {
    label: 'experienced-diagnostic-submit',
    chunks: toolCallResponse('experienced-diagnostic-submit-1', 'learning_submit_diagnostic', {
      command_id: 'phase-3-experienced-diagnostic-submit',
      assessments: [
        {
          candidate_id: 'diagnostic-plugin-context-service-effect-names-roles',
          status: 'meets',
          summary: 'The learner accurately distinguishes Plugin, Context, Service, Effect, and typed events.',
          evidence_kind: 'authored',
        },
        {
          candidate_id: 'diagnostic-plugin-context-service-effect-traces-disposal',
          status: 'uncertain',
          summary: 'The learner chose not to spend time proving the disposal trace during diagnosis.',
        },
        {
          candidate_id: 'diagnostic-capability-seam-explains-seam-roles',
          status: 'gap',
          summary: 'The learner has not yet demonstrated DSH capability-seam terminology.',
        },
        {
          candidate_id: 'diagnostic-capability-seam-implements-provider',
          status: 'uncertain',
          summary: 'Provider implementation evidence is not yet available.',
        },
        {
          candidate_id: 'diagnostic-model-callable-tool-traces-tool-loop',
          status: 'gap',
          summary: 'The learner has not traced DSH ToolRuntime and Session Log behavior.',
        },
        {
          candidate_id: 'diagnostic-model-callable-tool-implements-callable-tool',
          status: 'uncertain',
          summary: 'No DSH Tool implementation evidence is available.',
        },
        {
          candidate_id: 'diagnostic-bundle-profile-composition-distinguishes-composition-units',
          status: 'gap',
          summary: 'The learner has not demonstrated DSH-specific Profile and Bundle ownership.',
        },
        {
          candidate_id: 'diagnostic-bundle-profile-composition-validates-bundle',
          status: 'uncertain',
          summary: 'No bundle composition evidence is available.',
        },
      ],
    }),
  },
  {
    label: 'experienced-skip',
    chunks: toolCallResponse('experienced-skip-1', 'learning_skip_unit', {
      command_id: 'phase-3-experienced-skip',
      unit_id: 'plugin-context-service-effect',
      reason: 'The learner wants to continue directly to capability seams.',
    }),
  },
  {
    label: 'experienced-recommendation',
    chunks: textResponse('At your explicit request, the foundation unit is recorded as skipped even though the disposal trace remains uncertain. It satisfies navigation prerequisites but is not mastered, exercise-completed, or listed as a verified capability.'),
  },
  {
    label: 'capability-start',
    chunks: toolCallResponse('capability-start-1', 'learning_start_unit', {
      command_id: 'phase-4-capability-start', unit_id: 'capability-seam',
    }),
  },
  {
    label: 'capability-explain',
    chunks: toolCallResponse('capability-explain-1', 'learning_complete_activity', {
      command_id: 'phase-4-capability-explain',
      summary: 'Explained Service Definition, Provider, Consumer, and their dependency direction from locked sources.',
    }, 'Capability seam objective: separate the stable Service Definition, replaceable Provider, and Definition-only Consumer. Completion requires an authored dependency trace and a checked Provider implementation.'),
  },
  { label: 'capability-checkpoint-prompt', chunks: textResponse('Checkpoint: trace SubprocessRuntime → LocalSubprocessRuntime → a Consumer, then explain why the Consumer must not import the local Provider.') },
  {
    label: 'capability-checkpoint-answer',
    chunks: toolCallResponse('capability-checkpoint-1', 'learning_complete_activity', {
      command_id: 'phase-4-capability-checkpoint',
      summary: 'The learner traced the Definition, local Provider, and Definition-only Consumer.',
    }),
  },
  { label: 'capability-exercise-ready', chunks: textResponse('The isolated Clock Provider exercise is ready.') },
  {
    label: 'capability-blocked-check',
    chunks: toolCallResponse('capability-blocked-check-1', 'learning_complete_activity', {
      command_id: 'phase-4-capability-blocked-check',
      summary: 'Run the Provider check while its checker process is unavailable.',
    }),
  },
  {
    label: 'capability-blocked-feedback',
    chunks: toolCallResponse('capability-blocked-feedback-1', 'learning_complete_activity', {
      command_id: 'phase-4-capability-blocked-feedback',
      summary: 'Treat the environment timeout as blocked and retain the same attempt without lowering mastery.',
    }, 'The Provider check is blocked by an environment timeout, not failed for implementation. No mastery was reduced; restore the checker and retry the same attempt.'),
  },
  { label: 'capability-retry-ready', chunks: textResponse('The same Provider attempt is ready after environment recovery.') },
  {
    label: 'capability-pass-check',
    chunks: toolCallResponse('capability-pass-check-1', 'learning_complete_activity', {
      command_id: 'phase-4-capability-pass-check', summary: 'Run the restored Provider contract check.',
    }),
  },
  {
    label: 'capability-pass-feedback',
    chunks: toolCallResponse('capability-pass-feedback-1', 'learning_complete_activity', {
      command_id: 'phase-4-capability-pass-feedback', summary: 'The Provider contract and authored seam explanation satisfy completion.',
    }, 'The Clock Provider check passed with committed machine evidence.'),
  },
  { label: 'capability-completed', chunks: textResponse('The capability-seam unit is complete.') },
  {
    label: 'tool-start',
    chunks: toolCallResponse('tool-start-1', 'learning_start_unit', {
      command_id: 'phase-4-tool-start', unit_id: 'model-callable-tool',
    }),
  },
  {
    label: 'tool-explain',
    chunks: toolCallResponse('tool-explain-1', 'learning_complete_activity', {
      command_id: 'phase-4-tool-explain',
      summary: 'Explained Tool Schema, guarded execution, Native rendering, Agent Loop, and Session Log.',
    }, 'Tool objective: connect model-visible schema, guarded ToolRuntime execution, canonical output rendering, and durable Session Log evidence.'),
  },
  { label: 'tool-checkpoint-prompt', chunks: textResponse('Checkpoint: trace one tool call from request schema through execute and tool/result persistence.') },
  {
    label: 'tool-checkpoint-answer',
    chunks: toolCallResponse('tool-checkpoint-1', 'learning_complete_activity', {
      command_id: 'phase-4-tool-checkpoint', summary: 'The learner traced schema, execution, rendering, and persistence.',
    }),
  },
  { label: 'tool-exercise-ready', chunks: textResponse('The isolated greet Tool exercise is ready.') },
  {
    label: 'tool-pass-check',
    chunks: toolCallResponse('tool-pass-check-1', 'learning_complete_activity', {
      command_id: 'phase-4-tool-pass-check', summary: 'Run the deterministic greet Tool contract check.',
    }),
  },
  {
    label: 'tool-pass-feedback',
    chunks: toolCallResponse('tool-pass-feedback-1', 'learning_complete_activity', {
      command_id: 'phase-4-tool-pass-feedback', summary: 'The Tool flow explanation and machine contract satisfy completion.',
    }, 'The greet Tool contract passed with schema, execute, render, and registration evidence.'),
  },
  { label: 'tool-completed', chunks: textResponse('The model-callable-tool unit is complete.') },
  {
    label: 'bundle-start',
    chunks: toolCallResponse('bundle-start-1', 'learning_start_unit', {
      command_id: 'phase-4-bundle-start', unit_id: 'bundle-profile-composition',
    }),
  },
  {
    label: 'bundle-explain',
    chunks: toolCallResponse('bundle-explain-1', 'learning_complete_activity', {
      command_id: 'phase-4-bundle-explain',
      summary: 'Explained Profile, Bundle, Preset, Plugin ownership and patch layer ordering.',
    }, 'Bundle objective: keep behavior in plugins, use the bundle for patchable composition, and distinguish process-level Profile layers from per-agent Presets.'),
  },
  { label: 'bundle-checkpoint-prompt', chunks: textResponse('Checkpoint: explain which artifact owns behavior, which distributes rows, which names a deployment, and which scopes one Agent.') },
  {
    label: 'bundle-checkpoint-answer',
    chunks: toolCallResponse('bundle-checkpoint-1', 'learning_complete_activity', {
      command_id: 'phase-4-bundle-checkpoint', summary: 'The learner distinguished Plugin, Bundle, Profile, and Preset ownership.',
    }),
  },
  { label: 'bundle-exercise-ready', chunks: textResponse('The comprehensive Provider + Tool bundle exercise is ready.') },
  {
    label: 'bundle-pass-check',
    chunks: toolCallResponse('bundle-pass-check-1', 'learning_complete_activity', {
      command_id: 'phase-4-bundle-pass-check', summary: 'Run the comprehensive bundle contract check.',
    }),
  },
  {
    label: 'bundle-pass-feedback',
    chunks: toolCallResponse('bundle-pass-feedback-1', 'learning_complete_activity', {
      command_id: 'phase-4-bundle-pass-feedback', summary: 'The bundle metadata, patch rows, Provider, Tool, and authored explanation satisfy comprehensive validation.',
    }, 'The comprehensive bundle check passed and the course now has machine-backed evidence across all four units.'),
  },
  { label: 'learning-report', chunks: toolCallResponse('learning-report-1', 'learning_get_report', {}) },
  { label: 'course-completed', chunks: textResponse('Learning report: all eight outcomes are verified. Four units were exercise-completed, the bundle unit has comprehensive validation, no skipped unit was represented as mastered, and remaining misconceptions are listed from committed state.') },
]

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = resolve(directory, 'headless.patch.yml')
const sourceRoot = resolve(process.env.DSH_CHECKOUT ?? resolve(directory, '../../../deepseek-harness'))
const temporaryHome = process.env.DSH_HOME === undefined
  ? await mkdtemp(resolve(tmpdir(), 'learn-dsh-example-home-'))
  : undefined
const workspace = await mkdtemp(resolve(tmpdir(), 'learn-dsh-example-workspace-'))
const previousWorkspaceRoot = process.env.LEARN_DSH_WORKSPACE_ROOT
const previousSourceRoot = process.env.LEARN_DSH_SOURCE_ROOT
if (temporaryHome !== undefined) process.env.DSH_HOME = temporaryHome
process.env.LEARN_DSH_WORKSPACE_ROOT = workspace
process.env.LEARN_DSH_SOURCE_ROOT = sourceRoot

const ctx = await bootHeadlessProfile('learn-dsh-headless', configPath)
const adapter = new SnapshotAdapter([...script])
ctx.llm.registerAdapter(['snapshot'], adapter)

const originalSessionId = SessionId('phase-2-original-session')
const continuedSessionId = SessionId('phase-2-continued-session')
const experiencedSessionId = SessionId('phase-3-experienced-session')
const experiencedScope = Object.freeze({
  learnerId: LearnerId('experienced-learner'),
  enrollmentId: EnrollmentId('dsh-foundations-experienced'),
})
let original: AgentHandle | undefined
let resumed: AgentHandle | undefined
let continued: AgentHandle | undefined
let experienced: AgentHandle | undefined

async function activeAttemptWorkspace(handle: AgentHandle): Promise<string> {
  const state = await ctx.teaching.stateFor(handle.agent.id)
  const activity = state.currentActivity
  if (activity === null || activity.kind === 'diagnostic' || activity.attemptId === undefined) {
    throw new Error('expected an active exercise attempt')
  }
  const rootTarget = await ctx.fs.resolve('.learn-dsh/attempts', { cwd: workspace })
  for (const entry of await ctx.fs.listDir(rootTarget)) {
    if (entry.type !== 'directory') continue
    const candidate = ctx.fs.processPath(entry.target)
    const markerTarget = await ctx.fs.resolve('.learn-dsh-attempt.json', { cwd: candidate })
    const marker = JSON.parse(await ctx.fs.readText(markerTarget)) as { attemptId?: string }
    if (marker.attemptId === activity.attemptId) return candidate
  }
  throw new Error(`could not resolve workspace for attempt ${activity.attemptId}`)
}

async function writeAttemptFile(handle: AgentHandle, workspacePath: string, path: string, text: string): Promise<void> {
  const target = await ctx.fs.resolve(path, { cwd: workspacePath })
  await ctx.fs.writeText(target, text, undefined, undefined, ctx.sandboxPolicy.resolve({ session: handle.agent.session }))
}

const providerSolution = `import { Context, Service } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context { clock: Clock }
}

export abstract class Clock extends Service {
  abstract now(): number
}

export class LocalClock extends Clock {
  constructor(ctx: Context) { super(ctx, 'clock') }
  override now(): number { return Date.now() }
}

export function readClock(ctx: Context): number { return ctx.clock.now() }
`

const toolSolution = `import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export function greet(name: string): string { return \`Hello, \${name}!\` }

const greetTool = defineTool({
  name: 'greet',
  description: 'Greet one learner.',
  parameters: { name: { type: 'string', required: true } },
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { greeting: { type: 'string', required: true } } },
    render: (_args, value) => [{ type: 'text', text: value.greeting }],
  },
  execute(args) { return Promise.resolve({ greeting: greet(args.name) }) },
})

export function apply(ctx: Context): void { ctx.tools.register(greetTool) }
`

try {
  original = await ctx.agents.create({
    sessionId: originalSessionId,
    meta: { cwd: workspace },
    agentOptions: { provider: 'snapshot', model: 'phase-2-script' },
  })
  await followup(original, 'Explain how this teaching Session works and what permissions it has.')
  await followup(original, 'Start the first foundations unit and guide me through its real exercise.')
  await followup(original, 'The plugin fiber owns a scoped Context. It registers a replaceable Service or coordinates peers through typed events, and an Effect attaches the disposer so those registrations disappear when the fiber is disposed.')

  const attemptsRoot = await ctx.fs.resolve('.learn-dsh/attempts', { cwd: workspace })
  const attemptDirectories = (await ctx.fs.listDir(attemptsRoot))
    .filter(entry => entry.type === 'directory')
  if (attemptDirectories.length !== 1) throw new Error(`expected one exercise attempt, found ${attemptDirectories.length}`)
  const answer = await ctx.fs.resolve('answer.json', { cwd: ctx.fs.processPath(attemptDirectories[0]!.target) })
  await ctx.fs.writeText(answer, JSON.stringify({
    plugin: 'A plugin receives a scoped Context and owns every registration made through that scope.',
    context: 'Context is the scoped composition boundary inherited by the plugin fiber and its children.',
    service: 'A Service Definition exposes a named replaceable capability that Consumers access through ctx.',
    effect: 'An Effect binds setup and its disposer to the owning plugin fiber lifecycle.',
    typedEvent: 'A typed event coordinates peers without claiming ownership of a replaceable capability.',
    disposalEvidence: 'Disposing the plugin fiber runs the registered disposer and removes the contribution.',
    sourceRefs: ['docs/architecture.md', 'vendor/cordis/src/context.ts'],
  }, undefined, 2), undefined, undefined, ctx.sandboxPolicy.resolve({ session: original.agent.session }))

  await followup(original, 'I revised answer.json. Re-run the checks and finish the feedback step if evidence permits.')
  await original.dispose()
  original = undefined

  resumed = await ctx.agents.resume({
    resumeSessionId: originalSessionId,
    agentOptions: { provider: 'snapshot', model: 'phase-2-script' },
  })
  await followup(resumed, 'Resume this Session and confirm the committed learning state.')
  await resumed.dispose()
  resumed = undefined

  continued = await ctx.agents.create({
    sessionId: continuedSessionId,
    meta: { cwd: workspace },
    agentOptions: { provider: 'snapshot', model: 'phase-2-script' },
  })
  await followup(continued, 'Continue the same Enrollment in this new Session.')
  await continued.dispose()
  continued = undefined

  experienced = await ctx.agents.create({
    sessionId: experiencedSessionId,
    meta: { cwd: workspace },
    agentOptions: { provider: 'snapshot', model: 'phase-3-script' },
  })
  await ctx.teaching.bindSession(experiencedSessionId, experiencedScope)
  await followup(experienced, 'Diagnose my existing DSH knowledge and skip the foundation unit only if I explicitly request it and the evidence is sufficient. I request the skip if eligible.')
  await experienced.dispose()
  experienced = undefined

  continued = await ctx.agents.resume({
    resumeSessionId: continuedSessionId,
    agentOptions: { provider: 'snapshot', model: 'phase-4-script' },
  })
  await followup(continued, 'Continue with the capability seam unit and show its objectives and source-backed checkpoint.')
  await followup(continued, 'SubprocessRuntime is the Service Definition, LocalSubprocessRuntime is one Provider, and Consumers depend only on ctx.subprocess so replacement does not change them.')

  const capabilityWorkspace = await activeAttemptWorkspace(continued)
  const capabilityCheckTarget = await ctx.fs.resolve('check.mjs', { cwd: capabilityWorkspace })
  const capabilityCheck = await ctx.fs.readText(capabilityCheckTarget)
  await writeAttemptFile(continued, capabilityWorkspace, 'check.mjs', "setTimeout(() => {}, 60_000)\n")
  await followup(continued, 'Run the Provider check. If infrastructure blocks it, classify it without treating it as a learning failure.')
  await writeAttemptFile(continued, capabilityWorkspace, 'check.mjs', capabilityCheck)
  await writeAttemptFile(continued, capabilityWorkspace, 'provider.ts', providerSolution)
  await followup(continued, 'The checker is restored and provider.ts is complete. Retry the same attempt and finish only if machine evidence passes.')

  await followup(continued, 'Start the model-callable Tool unit and guide me to its checkpoint.')
  await followup(continued, 'The schema enters the model request, ToolRuntime validates and executes the call, Native rendering produces content, and tool/result persists the outcome in the Session Log.')
  const toolWorkspace = await activeAttemptWorkspace(continued)
  await writeAttemptFile(continued, toolWorkspace, 'tool.ts', toolSolution)
  await followup(continued, 'I implemented the greet Tool. Run its deterministic contract and finish the unit if it passes.')

  await followup(continued, 'Start the Bundle/Profile composition unit and guide me to the comprehensive exercise.')
  await followup(continued, 'A Plugin owns behavior, a Bundle distributes patchable rows, a Profile stacks deployment layers, and a Preset scopes one Agent composition.')
  const bundleWorkspace = await activeAttemptWorkspace(continued)
  await writeAttemptFile(continued, bundleWorkspace, 'provider.ts', providerSolution)
  await writeAttemptFile(continued, bundleWorkspace, 'tool.ts', toolSolution)
  await writeAttemptFile(continued, bundleWorkspace, 'cordis.patch.yml', `- insert:
    - id: clock-provider
      name: './provider.ts'
    - id: greet-tool
      name: './tool.ts'
`)
  await followup(continued, 'The Provider, Tool, metadata, and patch rows are complete. Run the comprehensive check, finish the course if evidence permits, and return the learning report.')
  await continued.dispose()
  continued = undefined

  if (adapter.requests.length !== script.length) {
    throw new Error(
      `expected ${script.length} scripted model requests, received ${adapter.requests.length}: `
      + adapter.requests.map(request => request.label).join(', '),
    )
  }

  const originalLog = await ctx.sessionPersistence.inspect(originalSessionId)
  const continuedLog = await ctx.sessionPersistence.inspect(continuedSessionId)
  const experiencedLog = await ctx.sessionPersistence.inspect(experiencedSessionId)
  const originalSnapshots = snapshotSections(originalLog.events)
  const continuedSnapshots = snapshotSections(continuedLog.events)
  const experiencedSnapshots = snapshotSections(experiencedLog.events)
  const journey = adapter.requests.map(request => summarizeRequest(
    request,
    request.label.startsWith('experienced-')
      ? experiencedSnapshots
      : request.label === 'new-session-continuity'
        || request.label.startsWith('capability-')
        || request.label.startsWith('tool-')
        || request.label.startsWith('bundle-')
        || request.label === 'learning-report'
        || request.label === 'course-completed'
        ? continuedSnapshots
        : originalSnapshots,
  ))
  if (journey.some(entry => !entry.exactSnapshotInSessionLog)) {
    throw new Error('a model-visible LearnerState snapshot was not found exactly in its Session Log')
  }

  const requestHeader = originalLog.events.find(event => event.type === 'request/header')
  if (requestHeader?.type !== 'request/header') throw new Error('original Session Log has no request/header')
  const assistantResponses = originalLog.events.flatMap(event =>
    event.type === 'assistant/message' ? [messageText(event.data.message)] : [])
  const firstResponse = assistantResponses[0]
  const lessonResponse = assistantResponses.find(text => text.startsWith('Objective:'))
  const checkpointResponse = assistantResponses.find(text => text.startsWith('Checkpoint:'))
  const failureResponse = assistantResponses.find(text => text.startsWith('Machine check failed'))
  const successResponse = assistantResponses.find(text => text.startsWith('Machine check passed'))
  if (firstResponse === undefined || lessonResponse === undefined || checkpointResponse === undefined
    || failureResponse === undefined || successResponse === undefined) {
    throw new Error('original Session Log is missing a Phase 2 teaching response')
  }
  const continuedResponses = continuedLog.events.flatMap(event =>
    event.type === 'assistant/message' ? [messageText(event.data.message)] : [])
  const blockedResponse = continuedResponses.find(text => text.startsWith('The Provider check is blocked'))
  const reportResponse = continuedResponses.find(text => text.startsWith('Learning report:'))
  if (blockedResponse === undefined || reportResponse === undefined) {
    throw new Error('continued Session Log is missing a Phase 4 blocked or report response')
  }
  const finalState = await ctx.teaching.stateFor(continuedSessionId)
  const learningReport = await ctx.teaching.getReport(continuedSessionId)
  const experiencedState = await ctx.learner.getState(experiencedScope)
  const memoryEvents = await ctx.learnerMemory.read(ctx.teaching.scopeFor(continuedSessionId))
  const assembly = await ctx.systemPrompt.assemble()

  process.stdout.write(`${JSON.stringify({
    prompt: {
      sections: assembly.sections.map(section => section.name),
      tools: assembly.tools.map(tool => tool.name),
      requestHeader: {
        hasTeacherPersona: requestHeader.data.header.system?.includes('You are Learn DeepSeek Harness') ?? false,
        tools: requestHeader.data.header.tools?.map(tool => tool.name) ?? [],
      },
      firstResponse,
      lessonResponse,
      checkpointResponse,
      failureResponse,
      successResponse,
      blockedResponse,
      reportResponse,
    },
    curriculum: {
      id: ctx.curriculum.course().id,
      version: ctx.curriculum.course().version,
      sourceVerification: ctx.curriculum.sourceVerification,
    },
    journey,
    sessionLog: {
      originalSessionId,
      originalRuntimeSnapshotCount: originalSnapshots.length,
      continuedSessionId,
      continuedRuntimeSnapshotCount: continuedSnapshots.length,
      experiencedSessionId,
      experiencedRuntimeSnapshotCount: experiencedSnapshots.length,
    },
    learnerMemory: {
      eventCount: memoryEvents.length,
      finalState: summarizeState(finalState),
      learningReport,
      experiencedState: summarizeState(experiencedState),
    },
  }, undefined, 2)}\n`)
} finally {
  await original?.dispose()
  await resumed?.dispose()
  await continued?.dispose()
  await experienced?.dispose()
  await ctx.fiber.dispose()
  if (previousWorkspaceRoot === undefined) delete process.env.LEARN_DSH_WORKSPACE_ROOT
  else process.env.LEARN_DSH_WORKSPACE_ROOT = previousWorkspaceRoot
  if (previousSourceRoot === undefined) delete process.env.LEARN_DSH_SOURCE_ROOT
  else process.env.LEARN_DSH_SOURCE_ROOT = previousSourceRoot
  await rm(workspace, { recursive: true, force: true })
  if (temporaryHome !== undefined) {
    await rm(temporaryHome, { recursive: true, force: true })
    delete process.env.DSH_HOME
  }
}
