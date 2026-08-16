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
export type DiagnosticCandidateId = string & { readonly __diagnosticCandidateId: unique symbol }
export type MisconceptionId = string & { readonly __misconceptionId: unique symbol }

const DOMAIN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

function domainId<T extends string>(value: string, label: string): T {
  if (!DOMAIN_ID_PATTERN.test(value)) throw new LearnerProjectionError('invalid-event', `${label} has invalid id "${value}"`)
  return value as T
}

export function ExerciseAttemptId(value: string): ExerciseAttemptId { return domainId<ExerciseAttemptId>(value, 'exercise attempt') }
export function EvidenceId(value: string): EvidenceId { return domainId<EvidenceId>(value, 'evidence') }
export function DiagnosticId(value: string): DiagnosticId { return domainId<DiagnosticId>(value, 'diagnostic') }
export function DiagnosticCandidateId(value: string): DiagnosticCandidateId { return domainId<DiagnosticCandidateId>(value, 'diagnostic candidate') }
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
  readonly evidenceIds: readonly EvidenceId[]
  readonly revision: number
}

export type DiagnosticAssessmentStatus = 'meets' | 'gap' | 'uncertain'

export interface LearnerDiagnosticAssessment {
  readonly candidateId: DiagnosticCandidateId
  readonly unitId: UnitId
  readonly rubricId: string
  readonly status: DiagnosticAssessmentStatus
  readonly summary: string
  readonly evidenceId?: EvidenceId
}

export interface LearnerDiagnostic {
  readonly diagnosticId: DiagnosticId
  readonly background: string
  readonly targetOutcomeIds: readonly string[]
  readonly candidateIds: readonly DiagnosticCandidateId[]
  readonly assessments: Readonly<Record<string, LearnerDiagnosticAssessment>>
  readonly completed: boolean
  readonly recommendedUnitId: UnitId | null
  readonly reason: string | null
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
  readonly diagnosticCandidateId?: DiagnosticCandidateId
  readonly rubricId?: string
  readonly source?: Readonly<{ path: string, anchorKind: string, anchor: string }>
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
  readonly diagnostic: LearnerDiagnostic | null
  readonly activePlan: LearnerPlan | null
  readonly currentActivity: TeachingActivity | Readonly<{ kind: 'diagnostic', diagnosticId: DiagnosticId }> | null
  readonly unitProgress: Readonly<Record<string, 'not-started' | 'in-progress' | 'completed' | 'waived'>>
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
const diagnosticCandidateIdSchema = id.transform(DiagnosticCandidateId)

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
  'learning/diagnostic-started': z.object({
    diagnosticId: id.transform(DiagnosticId),
    background: nonEmpty.optional(),
    targetOutcomeIds: z.array(id).min(1).optional(),
    candidateIds: z.array(diagnosticCandidateIdSchema).min(1).optional(),
  }).strict(),
  'learning/evidence-recorded': z.object({
    evidenceId: evidenceIdSchema,
    kind: z.enum(['authored', 'machine', 'observed']),
    summary: nonEmpty,
    unitId: unitIdSchema.optional(),
    attemptId: attemptIdSchema.optional(),
    diagnosticCandidateId: diagnosticCandidateIdSchema.optional(),
    rubricId: id.optional(),
    source: z.object({ path: nonEmpty, anchorKind: nonEmpty, anchor: nonEmpty }).strict().optional(),
  }).strict(),
  'learning/diagnostic-assessed': z.object({
    diagnosticId: id.transform(DiagnosticId),
    candidateId: diagnosticCandidateIdSchema,
    unitId: unitIdSchema,
    rubricId: id,
    status: z.enum(['meets', 'gap', 'uncertain']),
    summary: nonEmpty,
    evidenceId: evidenceIdSchema.optional(),
  }).strict(),
  'learning/diagnostic-completed': z.object({
    diagnosticId: id.transform(DiagnosticId),
    recommendedUnitId: unitIdSchema.nullable(),
    evidenceIds: z.array(evidenceIdSchema),
    reason: nonEmpty,
  }).strict(),
  'learning/plan-created': z.object({ unitIds: z.array(unitIdSchema).min(1), reason: nonEmpty, evidenceIds: z.array(evidenceIdSchema).optional() }).strict(),
  'learning/plan-adjusted': z.object({ unitIds: z.array(unitIdSchema).min(1), reason: nonEmpty, evidenceIds: z.array(evidenceIdSchema).optional() }).strict(),
  'learning/unit-waived': z.object({ unitId: unitIdSchema, evidenceIds: z.array(evidenceIdSchema).min(1), reason: nonEmpty }).strict(),
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
  'learning/misconception-resolved': z.object({
    misconceptionId: id.transform(MisconceptionId),
    evidenceIds: z.array(evidenceIdSchema).min(1),
    reason: nonEmpty,
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
  diagnostic: LearnerDiagnostic | null
  activePlan: LearnerPlan | null
  currentActivity: LearnerState['currentActivity']
  unitProgress: Record<string, 'not-started' | 'in-progress' | 'completed' | 'waived'>
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
    diagnostic: null,
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
  return state.activePlan?.unitIds.find(unitId => state.unitProgress[unitId] !== 'completed' && state.unitProgress[unitId] !== 'waived') ?? null
}

function prerequisiteSatisfied(state: MutableState, unitId: UnitId): boolean {
  return state.unitProgress[unitId] === 'completed' || state.unitProgress[unitId] === 'waived'
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
    case 'learning/diagnostic-started': {
      if (state.diagnostic !== null && !state.diagnostic.completed) throw new LearnerProjectionError('illegal-transition', 'another diagnostic is already active')
      const diagnosticId = data.diagnosticId as DiagnosticId
      const targetOutcomeIds = (data.targetOutcomeIds as string[] | undefined)
        ?? course.learningOutcomes.map(outcome => outcome.id as string)
      const candidateIds = (data.candidateIds as DiagnosticCandidateId[] | undefined) ?? []
      assertUnique(targetOutcomeIds, 'diagnostic targetOutcomeIds')
      assertUnique(candidateIds, 'diagnostic candidateIds')
      const availableOutcomes = new Set(course.learningOutcomes.map(outcome => outcome.id as string))
      for (const outcomeId of targetOutcomeIds) {
        if (!availableOutcomes.has(outcomeId)) throw new LearnerProjectionError('invalid-event', `diagnostic references missing outcome "${outcomeId}"`)
      }
      state.diagnostic = Object.freeze({
        diagnosticId,
        background: (data.background as string | undefined) ?? 'legacy-unspecified',
        targetOutcomeIds: Object.freeze([...targetOutcomeIds]),
        candidateIds: Object.freeze([...candidateIds]),
        assessments: Object.freeze({}),
        completed: false,
        recommendedUnitId: null,
        reason: null,
      })
      state.currentActivity = { kind: 'diagnostic', diagnosticId }
      break
    }
    case 'learning/evidence-recorded': {
      const evidenceId = data.evidenceId as EvidenceId
      if (state.evidence[evidenceId] !== undefined) throw new LearnerProjectionError('duplicate-domain-id', `EvidenceId "${evidenceId}" already exists`)
      const unitId = data.unitId as UnitId | undefined
      if (unitId !== undefined) assertKnownUnit(course, unitId)
      const attemptId = data.attemptId as ExerciseAttemptId | undefined
      const diagnosticCandidateId = data.diagnosticCandidateId as DiagnosticCandidateId | undefined
      const rubricId = data.rubricId as string | undefined
      const source = data.source as LearnerEvidence['source']
      if (data.kind === 'machine' && attemptId === undefined) {
        throw new LearnerProjectionError('illegal-transition', 'machine evidence must reference an exercise attempt')
      }
      if ((diagnosticCandidateId === undefined) !== (rubricId === undefined)) {
        throw new LearnerProjectionError('invalid-event', 'diagnostic evidence must include both diagnosticCandidateId and rubricId')
      }
      if (data.kind === 'observed' && diagnosticCandidateId !== undefined && source === undefined) {
        throw new LearnerProjectionError('invalid-event', 'observed diagnostic evidence must reference a curriculum source')
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
        ...(diagnosticCandidateId === undefined ? {} : { diagnosticCandidateId }),
        ...(rubricId === undefined ? {} : { rubricId }),
        ...(source === undefined ? {} : { source: Object.freeze({ ...source }) }),
      })
      break
    }
    case 'learning/diagnostic-assessed': {
      const diagnostic = state.diagnostic
      const diagnosticId = data.diagnosticId as DiagnosticId
      const candidateId = data.candidateId as DiagnosticCandidateId
      const unitId = data.unitId as UnitId
      const rubricId = data.rubricId as string
      const status = data.status as DiagnosticAssessmentStatus
      const evidenceId = data.evidenceId as EvidenceId | undefined
      if (diagnostic === null || diagnostic.completed || diagnostic.diagnosticId !== diagnosticId) {
        throw new LearnerProjectionError('illegal-transition', `diagnostic "${diagnosticId}" is not active`)
      }
      if (!diagnostic.candidateIds.includes(candidateId)) throw new LearnerProjectionError('invalid-event', `diagnostic has no candidate "${candidateId}"`)
      if (diagnostic.assessments[candidateId] !== undefined) throw new LearnerProjectionError('duplicate-domain-id', `diagnostic candidate "${candidateId}" is already assessed`)
      assertKnownUnit(course, unitId)
      const rubric = course.units.find(unit => unit.id === unitId)?.rubric.find(item => item.id === rubricId)
      if (rubric === undefined) throw new LearnerProjectionError('invalid-event', `unit "${unitId}" has no rubric "${rubricId}"`)
      if (status === 'meets') {
        if (evidenceId === undefined) throw new LearnerProjectionError('illegal-transition', 'meets assessment requires evidence')
        const evidence = state.evidence[evidenceId]
        if (evidence === undefined || evidence.unitId !== unitId || evidence.diagnosticCandidateId !== candidateId || evidence.rubricId !== rubricId) {
          throw new LearnerProjectionError('illegal-transition', `diagnostic evidence "${evidenceId}" does not match candidate "${candidateId}"`)
        }
        if (!rubric.evidenceKinds.includes(evidence.kind)) throw new LearnerProjectionError('illegal-transition', `evidence kind "${evidence.kind}" is not allowed by rubric "${rubricId}"`)
      } else if (evidenceId !== undefined) {
        throw new LearnerProjectionError('invalid-event', `${status} assessment cannot grant evidence`)
      }
      state.diagnostic = Object.freeze({
        ...diagnostic,
        assessments: Object.freeze({
          ...diagnostic.assessments,
          [candidateId]: Object.freeze({
            candidateId,
            unitId,
            rubricId,
            status,
            summary: data.summary as string,
            ...(evidenceId === undefined ? {} : { evidenceId }),
          }),
        }),
      })
      break
    }
    case 'learning/diagnostic-completed': {
      const diagnostic = state.diagnostic
      const diagnosticId = data.diagnosticId as DiagnosticId
      if (diagnostic === null || diagnostic.completed || diagnostic.diagnosticId !== diagnosticId) {
        throw new LearnerProjectionError('illegal-transition', `diagnostic "${diagnosticId}" is not active`)
      }
      for (const candidateId of diagnostic.candidateIds) {
        if (diagnostic.assessments[candidateId] === undefined) throw new LearnerProjectionError('illegal-transition', `diagnostic candidate "${candidateId}" is not assessed`)
      }
      const evidenceIds = data.evidenceIds as EvidenceId[]
      assertEvidence(state, evidenceIds, 'diagnostic evidenceIds')
      const recommendedUnitId = data.recommendedUnitId as UnitId | null
      if (recommendedUnitId !== null) assertKnownUnit(course, recommendedUnitId)
      state.diagnostic = Object.freeze({
        ...diagnostic,
        completed: true,
        recommendedUnitId,
        reason: data.reason as string,
      })
      state.currentActivity = null
      break
    }
    case 'learning/plan-created':
    case 'learning/plan-adjusted': {
      const unitIds = data.unitIds as UnitId[]
      assertUnique(unitIds, `${event.type} unitIds`)
      for (const unitId of unitIds) assertKnownUnit(course, unitId)
      const evidenceIds = (data.evidenceIds as EvidenceId[] | undefined) ?? []
      assertEvidence(state, evidenceIds, `${event.type} evidenceIds`)
      state.activePlan = Object.freeze({
        unitIds: Object.freeze([...unitIds]),
        reason: data.reason as string,
        evidenceIds: Object.freeze([...evidenceIds]),
        revision: (state.activePlan?.revision ?? 0) + 1,
      })
      const unitId = nextPlanUnit(state)
      state.nextRecommendation = { unitId, reason: data.reason as string }
      break
    }
    case 'learning/unit-waived': {
      const unitId = data.unitId as UnitId
      const unit = course.units.find(candidate => candidate.id === unitId)
      if (unit === undefined) throw new LearnerProjectionError('invalid-event', `course "${course.id}" has no unit "${unitId}"`)
      if (state.diagnostic?.completed !== true) throw new LearnerProjectionError('illegal-transition', 'unit waiver requires a completed diagnostic')
      if (state.currentActivity !== null) throw new LearnerProjectionError('illegal-transition', 'a unit cannot be waived while another activity is active')
      if (state.unitProgress[unitId] !== 'not-started') throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" cannot be waived from ${String(state.unitProgress[unitId])}`)
      for (const prerequisite of unit.prerequisites) {
        if (!prerequisiteSatisfied(state, prerequisite)) throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" prerequisite "${prerequisite}" is incomplete`)
      }
      const evidenceIds = data.evidenceIds as EvidenceId[]
      assertEvidence(state, evidenceIds, 'unit waiver evidenceIds')
      const evidence = evidenceIds.map(evidenceId => state.evidence[evidenceId]!)
      for (const rubricId of unit.completion.requiredRubricIds) {
        const assessment = Object.values(state.diagnostic.assessments).find(item => item.unitId === unitId && item.rubricId === rubricId)
        if (assessment?.status !== 'meets' || assessment.evidenceId === undefined || !evidenceIds.includes(assessment.evidenceId)) {
          throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" waiver lacks meets evidence for rubric "${rubricId}"`)
        }
        const match = state.evidence[assessment.evidenceId]
        const rubric = unit.rubric.find(item => item.id === rubricId)
        if (match === undefined || rubric === undefined || !rubric.evidenceKinds.includes(match.kind)) {
          throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" waiver has invalid evidence for rubric "${rubricId}"`)
        }
      }
      if (!evidence.some(item => item.kind === 'observed' || item.kind === 'machine')) {
        throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" waiver requires observed or machine evidence`)
      }
      const blockingAssessment = Object.values(state.diagnostic?.assessments ?? {}).find(assessment =>
        assessment.unitId === unitId && assessment.status !== 'meets')
      if (blockingAssessment !== undefined) throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" waiver is blocked by ${blockingAssessment.status} rubric "${blockingAssessment.rubricId}"`)
      state.unitProgress[unitId] = 'waived'
      const next = nextPlanUnit(state)
      state.nextRecommendation = { unitId: next, reason: next === null ? 'plan-complete-after-waiver' : 'next-plan-unit-after-waiver' }
      break
    }
    case 'learning/unit-started': {
      const unitId = data.unitId as UnitId
      const unit = course.units.find(candidate => candidate.id === unitId)
      if (unit === undefined) throw new LearnerProjectionError('invalid-event', `course "${course.id}" has no unit "${unitId}"`)
      for (const prerequisite of unit.prerequisites) {
        if (!prerequisiteSatisfied(state, prerequisite)) throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" prerequisite "${prerequisite}" is incomplete`)
      }
      if (state.unitProgress[unitId] === 'completed' || state.unitProgress[unitId] === 'waived') {
        throw new LearnerProjectionError('illegal-transition', `unit "${unitId}" is already ${state.unitProgress[unitId]}`)
      }
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
      const activity = state.currentActivity
      if (activity === null || activity.kind === 'diagnostic' || (activity.kind !== 'exercise' && activity.kind !== 'feedback') || activity.attemptId !== attemptId) {
        throw new LearnerProjectionError('illegal-transition', `hint requires active attempt "${attemptId}"`)
      }
      const level = data.level as 1 | 2 | 3
      const expected = attempt.hintLevels.length + 1
      if (level !== expected || expected > 3) throw new LearnerProjectionError('illegal-transition', `hint level ${String(level)} is not the next allowed level ${String(expected)}`)
      state.attempts[attemptId] = Object.freeze({ ...attempt, hintLevels: Object.freeze([...attempt.hintLevels, level]) })
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
    case 'learning/misconception-resolved': {
      const misconceptionId = data.misconceptionId as MisconceptionId
      const misconception = state.misconceptions[misconceptionId]
      if (misconception === undefined) throw new LearnerProjectionError('illegal-transition', `resolution references missing misconception "${misconceptionId}"`)
      if (misconception.resolved) throw new LearnerProjectionError('illegal-transition', `misconception "${misconceptionId}" is already resolved`)
      assertEvidence(state, data.evidenceIds as EvidenceId[], 'misconception resolution evidenceIds')
      state.misconceptions[misconceptionId] = Object.freeze({ ...misconception, resolved: true })
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
      const incomplete = course.units.find(unit => state.unitProgress[unit.id] !== 'completed' && state.unitProgress[unit.id] !== 'waived')
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
