#!/usr/bin/env node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import {
  CallId,
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
import type { LearnerState } from '@learn-dsh/learner'
import type {} from '@learn-dsh/lab/local'
import type {} from '@learn-dsh/teacher'
import type {} from '@learn-dsh/teaching'
import type {} from '@learn-dsh/tool-learning'

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
  const id = CallId(rawCallId)
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
    checks,
    exactSnapshotInSessionLog: sessionSnapshots.includes(request.learnerSnapshot),
  }
}

function summarizeState(state: LearnerState) {
  return {
    learnerId: state.learnerId,
    enrollmentId: state.enrollmentId,
    courseId: state.courseId,
    goal: state.goal,
    activePlan: state.activePlan,
    currentActivity: state.currentActivity,
    unitProgress: state.unitProgress,
    attempts: Object.values(state.attempts).map(attempt => ({
      attemptId: attempt.attemptId,
      exerciseId: attempt.exerciseId,
      unitId: attempt.unitId,
      checks: attempt.checks,
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
    }, 'Objective: explain how Plugin, Context, Service, typed events, and Effect disposal compose. Completion requires your own lifecycle trace plus a passed machine check. At DSH 0.1.0-rc.5 / 0cf6f648c80d, docs/architecture.md establishes the Cordis plugin tree, vendor/cordis/src/context.ts defines the scoped Context, and vendor/cordis/src/service.ts defines replaceable Service capabilities. A plugin receives its Context, registers services or typed-event coordination through that scope, and binds cleanup to its fiber with Effects/disposers.'),
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
]

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = resolve(directory, 'cordis.yml')
const sourceRoot = resolve(directory, '../../../deepseek-harness')
const temporaryHome = process.env.DSH_HOME === undefined
  ? await mkdtemp(resolve(tmpdir(), 'learn-dsh-example-home-'))
  : undefined
const workspace = await mkdtemp(resolve(tmpdir(), 'learn-dsh-example-workspace-'))
const previousWorkspaceRoot = process.env.LEARN_DSH_WORKSPACE_ROOT
const previousSourceRoot = process.env.LEARN_DSH_SOURCE_ROOT
if (temporaryHome !== undefined) process.env.DSH_HOME = temporaryHome
process.env.LEARN_DSH_WORKSPACE_ROOT = workspace
process.env.LEARN_DSH_SOURCE_ROOT = sourceRoot

const ctx = await boot('learn-dsh-headless', configPath)
const adapter = new SnapshotAdapter([...script])
ctx.llm.registerAdapter(['snapshot'], adapter)

const originalSessionId = SessionId('phase-2-original-session')
const continuedSessionId = SessionId('phase-2-continued-session')
let original: AgentHandle | undefined
let resumed: AgentHandle | undefined
let continued: AgentHandle | undefined

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

  if (adapter.requests.length !== script.length) {
    throw new Error(`expected ${script.length} scripted model requests, received ${adapter.requests.length}`)
  }

  const originalLog = await ctx.sessionPersistence.inspect(originalSessionId)
  const continuedLog = await ctx.sessionPersistence.inspect(continuedSessionId)
  const originalSnapshots = snapshotSections(originalLog.events)
  const continuedSnapshots = snapshotSections(continuedLog.events)
  const journey = adapter.requests.map(request => summarizeRequest(
    request,
    request.label === 'new-session-continuity' ? continuedSnapshots : originalSnapshots,
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
  const finalState = await ctx.teaching.stateFor(continuedSessionId)
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
    },
    learnerMemory: {
      eventCount: memoryEvents.length,
      finalState: summarizeState(finalState),
    },
  }, undefined, 2)}\n`)
} finally {
  await original?.dispose()
  await resumed?.dispose()
  await continued?.dispose()
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
