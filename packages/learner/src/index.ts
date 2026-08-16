/**
 * Learning event schemas, pure projection, and durable learner Service.
 *
 * @module @learn-dsh/learner
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { z } from 'zod'
import {
  CourseId,
  UnitId,
  type CourseManifest,
  type CurriculumService,
  type ExerciseId,
} from '@learn-dsh/curriculum'
import {
  CommandId,
  EnrollmentId,
  EventId,
  LearnerId,
  LEARNER_EVENT_VERSION,
  type JsonValue,
  type LearnerEventDraft,
  type LearnerEventEnvelope,
  type LearnerScope,
  type LearnerMemory,
} from '@learn-dsh/learner-memory'

declare module '@deepseek-ai/cordis' {
  interface Context {
    learner: LearnerService
  }
}

export type ExerciseAttemptId = string & { readonly __exerciseAttemptId: unique symbol }
export type EvidenceId = string & { readonly __evidenceId: unique symbol }
export type DiagnosticId = string & { readonly __diagnosticId: unique symbol }
export type MisconceptionId = string & { readonly __misconceptionId: unique symbol }

const DOMAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function domainId<T extends string>(value: string, label: string): T {
  if (!DOMAIN_ID_PATTERN.test(value)) throw new LearnerProjectionError('invalid-event', `${label} has invalid id "${value}"`)
  return value as T
}

export function ExerciseAttemptId(value: string): ExerciseAttemptId { return domainId<ExerciseAttemptId>(value, 'exercise attempt') }
export function EvidenceId(value: string): EvidenceId { return domainId<EvidenceId>(value, 'evidence') }
export function DiagnosticId(value: string): DiagnosticId { return domainId<DiagnosticId>(value, 'diagnostic') }
export function MisconceptionId(value: string): MisconceptionId { return domainId<MisconceptionId>(value, 'misconception') }

export function newEnrollmentId(): EnrollmentId { return EnrollmentId(randomUUID()) }
export function newEventId(): EventId { return EventId(randomUUID()) }
export function newCommandId(): CommandId { return CommandId(randomUUID()) }

export type CheckStatus = 'passed' | 'failed' | 'blocked'
export type CheckCategory = 'implementation' | 'configuration' | 'environment' | 'safety'
export type MasteryLevel = 'introduced' | 'practicing' | 'mastered'

export interface CheckResult {
  readonly checkId: string
  readonly status: CheckStatus
  readonly category: CheckCategory
  readonly summary: string
  readonly details: readonly string[]
  readonly artifacts: readonly string[]
}

export type TeachingActivityKind = 'explain' | 'checkpoint' | 'exercise' | 'feedback'

export interface TeachingActivity {
  readonly kind: TeachingActivityKind
  readonly unitId: UnitId
  readonly reason: string
  readonly checkpointId?: string
  readonly attemptId?: ExerciseAttemptId
}

export interface LearnerPlan {
  readonly unitIds: readonly UnitId[]
  readonly reason: string
  readonly revision: number
}

export interface LearnerAttempt {
  readonly attemptId: ExerciseAttemptId
  readonly exerciseId: ExerciseId
  readonly unitId: UnitId
  readonly checks: readonly CheckResult[]
  readonly hintLevels: readonly (1 | 2 | 3)[]
}

export interface LearnerEvidence {
  readonly evidenceId: EvidenceId
  readonly kind: 'authored' | 'machine' | 'observed'
  readonly summary: string
  readonly unitId?: UnitId
  readonly attemptId?: ExerciseAttemptId
}

export interface LearnerMisconception {
  readonly misconceptionId: MisconceptionId
  readonly summary: string
  readonly unitId?: UnitId
  readonly resolved: boolean
}

export interface LearnerMastery {
  readonly level: MasteryLevel
  readonly evidenceIds: readonly EvidenceId[]
  readonly reason: string
}

export interface LearnerState {
  readonly learnerId: LearnerId
  readonly enrollmentId: EnrollmentId
  readonly courseId: CourseId | null
  readonly goal: string | null
  readonly activePlan: LearnerPlan | null
  readonly currentActivity: TeachingActivity | Readonly<{ kind: 'diagnostic', diagnosticId: DiagnosticId }> | null
  readonly unitProgress: Readonly<Record<string, 'not-started' | 'in-progress' | 'completed'>>
  readonly attempts: Readonly<Record<string, LearnerAttempt>>
  readonly evidence: Readonly<Record<string, LearnerEvidence>>
  readonly misconceptions: Readonly<Record<string, LearnerMisconception>>
  readonly mastery: Readonly<Record<string, LearnerMastery>>
  readonly nextRecommendation: Readonly<{ unitId: UnitId | null, reason: string }> | null
  readonly courseCompleted: boolean
  readonly sourceSessionIds: readonly SessionId[]
  readonly appliedEventIds: readonly EventId[]
  readonly lastSeq: number
}

export type LearnerProjectionErrorCode =
  | 'duplicate-domain-id'
  | 'identity-mismatch'
  | 'illegal-transition'
  | 'invalid-event'
  | 'sequence-gap'
  | 'unknown-event'

export class LearnerProjectionError extends Error {
  constructor(readonly code: LearnerProjectionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LearnerProjectionError'
  }
}

const id = z.string().regex(DOMAIN_ID_PATTERN)
const nonEmpty = z.string().trim().min(1)
const unitIdSchema = id.transform(UnitId)
const courseIdSchema = id.transform(CourseId)
const attemptIdSchema = id.transform(ExerciseAttemptId)
const evidenceIdSchema = id.transform(EvidenceId)

const checkResultSchema = z.object({
  checkId: nonEmpty,
  status: z.enum(['passed', 'failed', 'blocked']),
  category: z.enum(['implementation', 'configuration', 'environment', 'safety']),
  summary: nonEmpty,
  details: z.array(nonEmpty),
  artifacts: z.array(nonEmpty),
}).strict()

const activityKindSchema = z.enum(['explain', 'checkpoint', 'exercise', 'feedback'])

const eventDataSchemas = {
  'learning/enrollment-created': z.object({ courseId: courseIdSchema }).strict(),
  'learning/goal-set': z.object({ goal: nonEmpty }).strict(),
  'learning/diagnostic-started': z.object({ diagnosticId: id.transform(DiagnosticId) }).strict(),
  'learning/evidence-recorded': z.object({
    evidenceId: evidenceIdSchema,
    kind: z.enum(['authored', 'machine', 'observed']),
    summary: nonEmpty,
    unitId: unitIdSchema.optional(),
    attemptId: attemptIdSchema.optional(),
  }).strict(),
  'learning/plan-created': z.object({ unitIds: z.array(unitIdSchema).min(1), reason: nonEmpty }).strict(),
  'learning/plan-adjusted': z.object({ unitIds: z.array(unitIdSchema).min(1), reason: nonEmpty }).strict(),
  'learning/unit-started': z.object({ unitId: unitIdSchema }).strict(),
  'learning/activity-advanced': z.object({
    unitId: unitIdSchema,
    from: activityKindSchema,
    to: activityKindSchema,
    reason: nonEmpty,
    checkpointId: id.optional(),
    attemptId: attemptIdSchema.optional(),
  }).strict(),
  'learning/exercise-created': z.object({ attemptId: attemptIdSchema, exerciseId: id, unitId: unitIdSchema }).strict(),
  'learning/checks-completed': z.object({ attemptId: attemptIdSchema, checks: z.array(checkResultSchema).min(1) }).strict(),
  'learning/hint-used': z.object({ attemptId: attemptIdSchema, level: z.union([z.literal(1), z.literal(2), z.literal(3)]) }).strict(),
  'learning/misconception-recorded': z.object({
    misconceptionId: id.transform(MisconceptionId),
    summary: nonEmpty,
    unitId: unitIdSchema.optional(),
  }).strict(),
  'learning/mastery-changed': z.object({
    unitId: unitIdSchema,
    level: z.enum(['introduced', 'practicing', 'mastered']),
    evidenceIds: z.array(evidenceIdSchema).min(1),
    reason: nonEmpty,
  }).strict(),
  'learning/unit-completed': z.object({ unitId: unitIdSchema, evidenceIds: z.array(evidenceIdSchema).min(1) }).strict(),
  'learning/course-completed': z.object({ courseId: courseIdSchema, evidenceIds: z.array(evidenceIdSchema).min(1) }).strict(),
} as const

export type LearningEventType = keyof typeof eventDataSchemas
export type LearningEventData<T extends LearningEventType> = z.infer<(typeof eventDataSchemas)[T]>
export type LearningEvent<T extends LearningEventType = LearningEventType> = {
  [K in T]: LearnerEventEnvelope<K, LearningEventData<K> & JsonValue>
}[T]

export type LearningEventInput = {
  [T in LearningEventType]: {
    readonly eventId: EventId
    readonly commandId?: CommandId
    readonly sourceSessionId: SessionId
    readonly type: T
    readonly data: LearningEventData<T> & JsonValue
  }
}[LearningEventType]

function parseLearningEvent(event: LearnerEventEnvelope): LearningEvent {
  const schema = eventDataSchemas[event.type as LearningEventType]
  if (schema === undefined) throw new LearnerProjectionError('unknown-event', `unknown required learner event type "${event.type}"`)
  try {
    const data = schema.parse(event.data) as LearningEventData<LearningEventType> & JsonValue
    return Object.freeze({ ...event, type: event.type as LearningEventType, data }) as LearningEvent
  } catch (cause) {
    throw new LearnerProjectionError('invalid-event', `learner event "${event.type}" has invalid data`, { cause })
  }
}

function assertKnownUnit(course: CourseManifest, unitId: UnitId): void {
  if (!course.units.some(unit => unit.id === unitId)) throw new LearnerProjectionError('invalid-event', `course "${course.id}" has no unit "${unitId}"`)
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) throw new LearnerProjectionError('invalid-event', `${label} repeats "${value}"`)
    seen.add(value)
  }
}

function assertEvidence(state: MutableState, evidenceIds: readonly EvidenceId[], label: string): void {
  assertUnique(evidenceIds, label)
  for (const evidenceId of evidenceIds) {
    if (state.evidence[evidenceId] === undefined) throw new LearnerProjectionError('illegal-transition', `${label} references missing evidence "${evidenceId}"`)
  }
}

interface MutableState {
  learnerId: LearnerId
  enrollmentId: EnrollmentId
  courseId: CourseId | null
  goal: string | null
  activePlan: LearnerPlan | null
  currentActivity: LearnerState['currentActivity']
  unitProgress: Record<string, 'not-started' | 'in-progress' | 'completed'>
  attempts: Record<string, LearnerAttempt>
  evidence: Record<string, LearnerEvidence>
  misconceptions: Record<string, LearnerMisconception>
  mastery: Record<string, LearnerMastery>
  nextRecommendation: { unitId: UnitId | null, reason: string } | null
  courseCompleted: boolean
  sourceSessionIds: SessionId[]
  appliedEventIds: EventId[]
  lastSeq: number
}

function initialState(scope: LearnerScope, course: CourseManifest): MutableState {
  return {
    learnerId: scope.learnerId,
    enrollmentId: scope.enrollmentId,
    courseId: null,
    goal: null,
    activePlan: null,
    currentActivity: null,
    unitProgress: Object.fromEntries(course.units.map(unit => [unit.id, 'not-started'])),
    attempts: {},
    evidence: {},
    misconceptions: {},
    mastery: {},
    nextRecommendation: null,
    courseCompleted: false,
    sourceSessionIds: [],
    appliedEventIds: [],
    lastSeq: -1,
  }
}

function nextPlanUnit(state: MutableState): UnitId | null {
  return state.activePlan?.unitIds.find(unitId => state.unitProgress[unitId] !== 'completed') ?? null
}

function applyEvent(state: MutableState, raw: LearnerEventEnvelope, course: CourseManifest): void {
  const event = parseLearningEvent(raw)
  const data = event.data as Record<string, unknown>
  switch (event.type) {
    case 'learning/enrollment-created': {
      const courseId = data.courseId as CourseId
      if (state.courseId !== null) throw new LearnerProjectionError('illegal-transition', 'enrollment can only be created once')
      if (courseId !== course.id) throw new LearnerProjectionError('invalid-event', `enrollment course "${courseId}" does not match loaded course "${course.id}"`)
      state.courseId = courseId
      break
    }
    case 'learning/goal-set':
      state.goal = data.goal as string
      break
    case 'learning/diagnostic-started':
      state.currentActivity = { kind: 'diagnostic', diagnosticId: data.diagnosticId as DiagnosticId }
      break
    case 'learning/evidence-recorded': {
      const evidenceId = data.evidenceId as EvidenceId
      if (state.evidence[evidenceId] !== undefined) throw new LearnerProjectionError('duplicate-domain-id', `EvidenceId "${evidenceId}" already exists`)
      const unitId = data.unitId as UnitId | undefined
      if (unitId !== undefined) assertKnownUnit(course, unitId)
      const attemptId = data.attemptId as ExerciseAttemptId | undefined
      if (data.kind === 'machine' && attemptId === undefined) {
        throw new LearnerProjectionError('illegal-transition', 'machine evidence must reference an exercise attempt')
      }
      if (attemptId !== undefined) {
        const attempt = state.attempts[attemptId]
        if (attempt === undefined) throw new LearnerProjectionError('illegal-transition', `evidence references missing attempt "${attemptId}"`)
        if (unitId !== undefined && attempt.unitId !== unitId) throw new LearnerProjectionError('illegal-transition', `evidence attempt "${attemptId}" belongs to another unit`)
      }
      state.evidence[evidenceId] = Object.freeze({
        evidenceId,
        kind: data.kind as LearnerEvidence['kind'],
        summary: data.summary as string,
        ...(unitId === undefined ? {} : { unitId }),
        ...(attemptId === undefined ? {} : { attemptId }),
      })
      break
    }
    case 'learning/plan-created':
    case 'learning/plan-adjusted': {
      const unitIds = data.unitIds as UnitId[]
      assertUnique(unitIds, `${event.type} unitIds`)
      for (const unitId of unitIds) assertKnownUnit(course, unitId)
      state.activePlan = Object.freeze({ unitIds: Object.freeze([...unitIds]), reason: data.reason as string, revision: (state.activePlan?.revision ?? 0) + 1 })
      const unitId = nextPlanUnit(state)
      state.nextRecommendation = { unitId, reason: data.reason as string }
      break
    }
    case 'learning/unit-started': {
      const unitId = data.unitId as UnitId
      const unit = course.units.find(candidate => candidate.id === unitId)
      if (unit === undefined) throw new LearnerProjectionError('invalid-event', `course "${course.id}" has no unit "${unitId}"`)
      for (const prerequisite of unit.prerequisites) {
        if (state.unitProgress[prerequisite] !== 'completed') throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" prerequisite "${prerequisite}" is incomplete`)
      }
      if (state.unitProgress[unitId] === 'completed') throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" is already completed`)
      state.unitProgress[unitId] = 'in-progress'
      state.currentActivity = { kind: 'explain', unitId, reason: 'unit-started' }
      break
    }
    case 'learning/activity-advanced': {
      const unitId = data.unitId as UnitId
      const from = data.from as TeachingActivityKind
      const to = data.to as TeachingActivityKind
      const current = state.currentActivity
      if (current === null || current.kind === 'diagnostic' || current.unitId !== unitId || current.kind !== from) {
        throw new LearnerProjectionError('illegal-transition', `activity transition expected active ${from} for unit "${unitId}"`)
      }
      const transition = `${from}->${to}`
      if (transition !== 'explain->checkpoint' && transition !== 'exercise->feedback' && transition !== 'feedback->exercise') {
        throw new LearnerProjectionError('illegal-transition', `unsupported activity transition "${transition}"`)
      }
      const checkpointId = data.checkpointId as string | undefined
      const attemptId = data.attemptId as ExerciseAttemptId | undefined
      if (to === 'checkpoint') {
        const unit = course.units.find(candidate => candidate.id === unitId)
        if (checkpointId === undefined || !unit?.checkpoints.some(checkpoint => checkpoint.id === checkpointId)) {
          throw new LearnerProjectionError('illegal-transition', `checkpoint activity requires a known checkpoint for unit "${unitId}"`)
        }
      }
      if (to === 'exercise' || to === 'feedback') {
        const attempt = attemptId === undefined ? undefined : state.attempts[attemptId]
        if (attempt === undefined || attempt.unitId !== unitId) {
          throw new LearnerProjectionError('illegal-transition', `${to} activity requires an attempt for unit "${unitId}"`)
        }
        if ((from === 'exercise' || from === 'feedback') && current.attemptId !== attemptId) {
          throw new LearnerProjectionError('illegal-transition', `activity transition must retain attempt "${String(current.attemptId)}"`)
        }
        if (to === 'feedback' && attempt.checks.length === 0) {
          throw new LearnerProjectionError('illegal-transition', 'feedback activity requires completed checks')
        }
        if (from === 'feedback' && to === 'exercise' && attempt.checks.every(check => check.status === 'passed')) {
          throw new LearnerProjectionError('illegal-transition', 'passed feedback cannot return to the exercise')
        }
      }
      state.currentActivity = Object.freeze({
        kind: to,
        unitId,
        reason: data.reason as string,
        ...(checkpointId === undefined ? {} : { checkpointId }),
        ...(attemptId === undefined ? {} : { attemptId }),
      })
      break
    }
    case 'learning/exercise-created': {
      const attemptId = data.attemptId as ExerciseAttemptId
      const unitId = data.unitId as UnitId
      assertKnownUnit(course, unitId)
      if (state.unitProgress[unitId] !== 'in-progress') throw new LearnerProjectionError('illegal-transition', `exercise unit "${unitId}" is not active`)
      if (state.currentActivity?.kind !== 'checkpoint' || state.currentActivity.unitId !== unitId) {
        throw new LearnerProjectionError('illegal-transition', `exercise unit "${unitId}" has no active checkpoint`)
      }
      if (state.attempts[attemptId] !== undefined) throw new LearnerProjectionError('duplicate-domain-id', `ExerciseAttemptId "${attemptId}" already exists`)
      state.attempts[attemptId] = Object.freeze({
        attemptId,
        exerciseId: data.exerciseId as ExerciseId,
        unitId,
        checks: Object.freeze([]),
        hintLevels: Object.freeze([]),
      })
      state.currentActivity = { kind: 'exercise', unitId, attemptId, reason: 'exercise-created' }
      break
    }
    case 'learning/checks-completed': {
      const attemptId = data.attemptId as ExerciseAttemptId
      const attempt = state.attempts[attemptId]
      if (attempt === undefined) throw new LearnerProjectionError('illegal-transition', `checks reference missing attempt "${attemptId}"`)
      if (state.currentActivity?.kind !== 'exercise' || state.currentActivity.attemptId !== attemptId) {
        throw new LearnerProjectionError('illegal-transition', `checks require active exercise attempt "${attemptId}"`)
      }
      state.attempts[attemptId] = Object.freeze({ ...attempt, checks: Object.freeze(data.checks as CheckResult[]) })
      break
    }
    case 'learning/hint-used': {
      const attemptId = data.attemptId as ExerciseAttemptId
      const attempt = state.attempts[attemptId]
      if (attempt === undefined) throw new LearnerProjectionError('illegal-transition', `hint references missing attempt "${attemptId}"`)
      state.attempts[attemptId] = Object.freeze({ ...attempt, hintLevels: Object.freeze([...attempt.hintLevels, data.level as 1 | 2 | 3]) })
      break
    }
    case 'learning/misconception-recorded': {
      const misconceptionId = data.misconceptionId as MisconceptionId
      if (state.misconceptions[misconceptionId] !== undefined) throw new LearnerProjectionError('duplicate-domain-id', `MisconceptionId "${misconceptionId}" already exists`)
      const unitId = data.unitId as UnitId | undefined
      if (unitId !== undefined) assertKnownUnit(course, unitId)
      state.misconceptions[misconceptionId] = Object.freeze({
        misconceptionId,
        summary: data.summary as string,
        ...(unitId === undefined ? {} : { unitId }),
        resolved: false,
      })
      break
    }
    case 'learning/mastery-changed': {
      const unitId = data.unitId as UnitId
      assertKnownUnit(course, unitId)
      const evidenceIds = data.evidenceIds as EvidenceId[]
      assertEvidence(state, evidenceIds, 'mastery evidenceIds')
      state.mastery[unitId] = Object.freeze({ level: data.level as MasteryLevel, evidenceIds: Object.freeze([...evidenceIds]), reason: data.reason as string })
      break
    }
    case 'learning/unit-completed': {
      const unitId = data.unitId as UnitId
      if (state.unitProgress[unitId] !== 'in-progress') throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" is not in progress`)
      if (state.currentActivity?.kind !== 'feedback' || state.currentActivity.unitId !== unitId || state.currentActivity.attemptId === undefined) {
        throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" completion requires active exercise feedback`)
      }
      const evidenceIds = data.evidenceIds as EvidenceId[]
      assertEvidence(state, evidenceIds, 'unit completion evidenceIds')
      const attempt = state.attempts[state.currentActivity.attemptId]
      if (attempt === undefined || attempt.checks.length === 0 || attempt.checks.some(check => check.status !== 'passed')) {
        throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" completion requires passed machine checks`)
      }
      const hasMachineEvidence = evidenceIds.some(evidenceId => {
        const evidence = state.evidence[evidenceId]
        return evidence?.kind === 'machine' && evidence.unitId === unitId && evidence.attemptId === attempt.attemptId
      })
      if (!hasMachineEvidence) throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" completion requires machine evidence for the active attempt`)
      if (state.mastery[unitId]?.level !== 'mastered') throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" completion requires mastered evidence state`)
      state.unitProgress[unitId] = 'completed'
      state.currentActivity = null
      const next = nextPlanUnit(state)
      state.nextRecommendation = { unitId: next, reason: next === null ? 'plan-complete' : 'next-plan-unit' }
      break
    }
    case 'learning/course-completed': {
      const courseId = data.courseId as CourseId
      if (courseId !== course.id || state.courseId !== courseId) throw new LearnerProjectionError('illegal-transition', `course completion does not match enrollment course "${String(state.courseId)}"`)
      assertEvidence(state, data.evidenceIds as EvidenceId[], 'course completion evidenceIds')
      const incomplete = course.units.find(unit => state.unitProgress[unit.id] !== 'completed')
      if (incomplete !== undefined) throw new LearnerProjectionError('illegal-transition', `course cannot complete while unit "${incomplete.id}" is incomplete`)
      state.courseCompleted = true
      state.currentActivity = null
      state.nextRecommendation = { unitId: null, reason: 'course-complete' }
      break
    }
  }
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

function freezeState(state: MutableState): LearnerState {
  return deepFreeze({
    ...state,
    unitProgress: Object.freeze({ ...state.unitProgress }),
    attempts: Object.freeze({ ...state.attempts }),
    evidence: Object.freeze({ ...state.evidence }),
    misconceptions: Object.freeze({ ...state.misconceptions }),
    mastery: Object.freeze({ ...state.mastery }),
    sourceSessionIds: Object.freeze([...state.sourceSessionIds]),
    appliedEventIds: Object.freeze([...state.appliedEventIds]),
    ...(state.nextRecommendation === null ? {} : { nextRecommendation: { ...state.nextRecommendation } }),
  })
}

/** Deterministically fold one durable event prefix into immutable LearnerState. */
export function projectLearnerState(scope: LearnerScope, events: readonly LearnerEventEnvelope[], course: CourseManifest): LearnerState {
  const state = initialState(scope, course)
  const seen = new Map<EventId, LearnerEventEnvelope>()
  let expectedSeq = 0
  for (const event of events) {
    const prior = seen.get(event.eventId)
    if (prior !== undefined) {
      if (JSON.stringify(prior) !== JSON.stringify(event)) throw new LearnerProjectionError('duplicate-domain-id', `EventId "${event.eventId}" has conflicting replay data`)
      continue
    }
    if (event.learnerId !== scope.learnerId || event.enrollmentId !== scope.enrollmentId) {
      throw new LearnerProjectionError('identity-mismatch', `event "${event.eventId}" belongs to another learner or enrollment`)
    }
    if (event.seq !== expectedSeq) throw new LearnerProjectionError('sequence-gap', `expected learner event seq ${String(expectedSeq)} but found ${String(event.seq)}`)
    if (expectedSeq === 0 && event.type !== 'learning/enrollment-created') throw new LearnerProjectionError('illegal-transition', 'the first learner event must create the enrollment')
    if (expectedSeq > 0 && state.courseId === null) throw new LearnerProjectionError('illegal-transition', 'learning events require a created enrollment')
    applyEvent(state, event, course)
    seen.set(event.eventId, event)
    expectedSeq += 1
    state.lastSeq = event.seq
    state.appliedEventIds.push(event.eventId)
    if (!state.sourceSessionIds.includes(event.sourceSessionId)) state.sourceSessionIds.push(event.sourceSessionId)
  }
  return freezeState(state)
}

export interface LearnerAppendResult {
  readonly event: LearningEvent
  readonly appended: boolean
  readonly state: LearnerState
}

/** Durable learner query and command Service. */
export class LearnerService extends Service {
  static inject = ['learnerMemory', 'curriculum']

  private readonly memory: LearnerMemory
  private readonly curriculum: CurriculumService

  constructor(ctx: Context) {
    const memory = ctx.get('learnerMemory')
    if (memory === undefined) throw new Error('learn-dsh learner requires the learnerMemory Service')
    const curriculum = ctx.get('curriculum')
    if (curriculum === undefined) throw new Error('learn-dsh learner requires the curriculum Service')
    super(ctx, 'learner')
    this.memory = memory
    this.curriculum = curriculum
  }

  async getState(scope: LearnerScope): Promise<LearnerState> {
    const events = await this.memory.read(scope)
    return projectLearnerState(scope, events, this.curriculum.course())
  }

  async append(scope: LearnerScope, input: LearningEventInput): Promise<LearnerAppendResult> {
    const course = this.curriculum.course()
    const existing = await this.memory.read(scope)
    const draft: LearnerEventDraft = {
      ...scope,
      eventId: input.eventId,
      ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
      sourceSessionId: input.sourceSessionId,
      type: input.type,
      version: LEARNER_EVENT_VERSION,
      data: input.data,
    }
    const prior = existing.find(event => event.eventId === draft.eventId || (draft.commandId !== undefined && event.commandId === draft.commandId))
    if (prior === undefined) {
      const candidate = Object.freeze({ ...draft, seq: existing.length, time: 0 })
      projectLearnerState(scope, [...existing, candidate], course)
    }
    const committed = await this.memory.append(draft)
    const events = await this.memory.read(scope)
    const state = projectLearnerState(scope, events, course)
    return Object.freeze({ event: parseLearningEvent(committed.event), appended: committed.appended, state })
  }

  createEnrollment(scope: LearnerScope, input: Omit<Extract<LearningEventInput, { type: 'learning/enrollment-created' }>, 'type'>): Promise<LearnerAppendResult> {
    return this.append(scope, { ...input, type: 'learning/enrollment-created' })
  }

  flush(scope?: LearnerScope): Promise<void> {
    return this.memory.flush(scope)
  }
}

export {
  CommandId,
  EnrollmentId,
  EventId,
  LearnerId,
  type LearnerScope,
}

export default LearnerService
