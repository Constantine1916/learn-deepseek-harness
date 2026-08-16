/** Deterministic diagnostic planner and teaching activity state machine. */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  UnitId,
  type CourseManifest,
  type CurriculumExercise,
  type CurriculumUnit,
  type EvidenceKind,
  type SourceAnchor,
} from '@learn-dsh/curriculum'
import type { LabAttempt } from '@learn-dsh/lab'
import {
  CommandId,
  DiagnosticCandidateId,
  DiagnosticId,
  EnrollmentId,
  EventId,
  EvidenceId,
  ExerciseAttemptId,
  LearnerId,
  MisconceptionId,
  type CheckResult,
  type LearnerState,
  type LearnerEvidence,
  type LearningEventInput,
} from '@learn-dsh/learner'
import type { LearnerScope } from '@learn-dsh/learner-memory'

declare module '@deepseek-ai/cordis' {
  interface Context {
    teaching: TeachingService
  }
}

export interface Config {
  /** Trusted local learner identity used when a Session has no explicit binding. */
  learnerId: string
  /** Trusted default Enrollment shared by Sessions in this teaching composition. */
  enrollmentId: string
}

export const Config: z<Config> = z.object({
  learnerId: z.string().required(),
  enrollmentId: z.string().required(),
})

export type TeachingOutcome = 'checkpoint-ready' | 'exercise-ready' | 'feedback-ready' | 'retry-exercise' | 'unit-completed'

export interface DiagnosticCandidate {
  readonly candidateId: DiagnosticCandidateId
  readonly unitId: UnitId
  readonly rubricId: string
  readonly objective: string
  readonly criterion: string
  readonly allowedEvidenceKinds: readonly EvidenceKind[]
  readonly sources: readonly SourceAnchor[]
}

export interface DiagnosticAssessmentInput {
  readonly candidateId: string
  readonly status: 'meets' | 'gap' | 'uncertain'
  readonly summary: string
  readonly evidenceKind?: EvidenceKind
  readonly sourcePath?: string
  readonly sourceAnchorKind?: string
  readonly sourceAnchor?: string
  readonly existingEvidenceId?: string
}

export interface WaiverEligibility {
  readonly unitId: UnitId
  readonly eligible: boolean
  readonly evidenceIds: readonly EvidenceId[]
  readonly blockers: readonly string[]
}

export interface DiagnosticCommandResult {
  readonly state: LearnerState
  readonly candidates: readonly DiagnosticCandidate[]
  readonly waiverEligibility: readonly WaiverEligibility[]
}

export interface TeachingCommandResult {
  readonly outcome: TeachingOutcome
  readonly state: LearnerState
  readonly attempt?: LabAttempt
  readonly checks?: readonly CheckResult[]
}

export class TeachingError extends Error {
  constructor(readonly code: 'invalid-command' | 'invalid-state' | 'planner-rejected', message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TeachingError'
  }
}

function scopeKey(scope: LearnerScope): string {
  return `${scope.learnerId}\0${scope.enrollmentId}`
}

function identity(root: string, suffix: string): { eventId: EventId, commandId: CommandId } {
  const digest = createHash('sha256').update(`${root}\0${suffix}`).digest('hex')
  return { eventId: EventId(`event-${digest}`), commandId: CommandId(`command-${digest}`) }
}

function attemptIdentity(root: string): ExerciseAttemptId {
  return ExerciseAttemptId(`attempt-${createHash('sha256').update(`${root}\0attempt`).digest('hex').slice(0, 32)}`)
}

function diagnosticIdentity(root: string): DiagnosticId {
  return DiagnosticId(`diagnostic-${createHash('sha256').update(`${root}\0diagnostic`).digest('hex').slice(0, 32)}`)
}

function diagnosticCandidateId(unitId: UnitId, rubricId: string): DiagnosticCandidateId {
  const readable = `diagnostic-${unitId}-${rubricId}`
  if (readable.length <= 128) return DiagnosticCandidateId(readable)
  return DiagnosticCandidateId(`diagnostic-${createHash('sha256').update(`${unitId}\0${rubricId}`).digest('hex')}`)
}

function topologicalUnits(course: CourseManifest): readonly UnitId[] {
  const result: UnitId[] = []
  const remaining = new Set(course.units.map(unit => unit.id))
  while (remaining.size > 0) {
    const next = course.units.find(unit => remaining.has(unit.id) && unit.prerequisites.every(id => result.includes(id)))
    if (next === undefined) throw new TeachingError('invalid-state', 'validated curriculum has no deterministic topological order')
    result.push(next.id)
    remaining.delete(next.id)
  }
  return Object.freeze(result)
}

function targetUnits(course: CourseManifest, targetOutcomeIds: readonly string[]): readonly UnitId[] {
  const knownOutcomes = new Set(course.learningOutcomes.map(outcome => outcome.id as string))
  for (const outcomeId of targetOutcomeIds) {
    if (!knownOutcomes.has(outcomeId)) throw new TeachingError('invalid-command', `course "${course.id}" has no learning outcome "${outcomeId}"`)
  }
  const included = new Set<UnitId>()
  const include = (unitId: UnitId): void => {
    if (included.has(unitId)) return
    const unit = course.units.find(candidate => candidate.id === unitId)
    if (unit === undefined) throw new TeachingError('invalid-state', `course "${course.id}" has no unit "${unitId}"`)
    for (const prerequisite of unit.prerequisites) include(prerequisite)
    included.add(unitId)
  }
  for (const unit of course.units) {
    if (unit.outcomeIds.some(outcomeId => targetOutcomeIds.includes(outcomeId as string))) include(unit.id)
  }
  const ordered = topologicalUnits(course).filter(unitId => included.has(unitId))
  if (ordered.length === 0) throw new TeachingError('invalid-command', 'the selected outcomes have no curriculum units')
  return Object.freeze(ordered)
}

/** Build stable diagnostic candidates from the selected path's objectives and required rubric. */
export function buildDiagnosticCandidates(course: CourseManifest, targetOutcomeIds: readonly string[]): readonly DiagnosticCandidate[] {
  const units = targetUnits(course, targetOutcomeIds)
  return Object.freeze(units.flatMap(unitId => {
    const unit = course.units.find(candidate => candidate.id === unitId)!
    return unit.completion.requiredRubricIds.map((rubricId, index) => {
      const rubric = unit.rubric.find(item => item.id === rubricId)
      if (rubric === undefined) throw new TeachingError('invalid-state', `unit "${unit.id}" completion references missing rubric "${rubricId}"`)
      return Object.freeze({
        candidateId: diagnosticCandidateId(unit.id, rubric.id),
        unitId: unit.id,
        rubricId: rubric.id as string,
        objective: unit.objectives[index % unit.objectives.length]!,
        criterion: rubric.criterion,
        allowedEvidenceKinds: Object.freeze([...rubric.evidenceKinds]),
        sources: Object.freeze([...unit.sources]),
      })
    })
  }))
}

function nonEmpty(value: string | undefined, label: string): string {
  const normalized = value?.trim()
  if (normalized === undefined || normalized.length === 0) throw new TeachingError('invalid-command', `${label} must be a non-empty string`)
  return normalized
}

/** Durable deterministic teaching coordinator. */
export class TeachingService extends Service {
  static inject = ['learner', 'curriculum', 'lab']
  static Config = Config

  private readonly defaultScope: LearnerScope
  private readonly bindings = new Map<SessionId, LearnerScope>()
  private readonly states = new Map<string, LearnerState>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'teaching')
    this.defaultScope = Object.freeze({ learnerId: LearnerId(config.learnerId), enrollmentId: EnrollmentId(config.enrollmentId) })
  }

  protected async [Service.init](): Promise<void> {
    await this.refresh(this.defaultScope)
  }

  private async refresh(scope: LearnerScope): Promise<LearnerState> {
    const state = await this.ctx.learner.getState(scope)
    this.states.set(scopeKey(scope), state)
    return state
  }

  bindSession(sessionId: SessionId, scope: LearnerScope = this.defaultScope): Promise<LearnerState> {
    this.bindings.set(sessionId, Object.freeze({ ...scope }))
    return this.refresh(scope)
  }

  unbindSession(sessionId: SessionId): void {
    this.bindings.delete(sessionId)
  }

  scopeFor(sessionId: SessionId): LearnerScope {
    return this.bindings.get(sessionId) ?? this.defaultScope
  }

  snapshotFor(sessionId: SessionId): LearnerState {
    const scope = this.scopeFor(sessionId)
    const state = this.states.get(scopeKey(scope))
    if (state === undefined) throw new TeachingError('invalid-state', `learner state for Session "${sessionId}" is not initialized`)
    return state
  }

  stateFor(sessionId: SessionId): Promise<LearnerState> {
    return this.refresh(this.scopeFor(sessionId))
  }

  private unit(course: CourseManifest, unitId: UnitId): CurriculumUnit {
    const unit = course.units.find(candidate => candidate.id === unitId)
    if (unit === undefined) throw new TeachingError('invalid-command', `course "${course.id}" has no unit "${unitId}"`)
    return unit
  }

  private exercise(unit: CurriculumUnit): CurriculumExercise {
    const exercise = unit.exercises[0]
    if (exercise === undefined) throw new TeachingError('invalid-state', `unit "${unit.id}" has no exercise`)
    return exercise
  }

  private recommended(state: LearnerState, course: CourseManifest): UnitId | null {
    const plan = state.activePlan?.unitIds ?? topologicalUnits(course)
    return plan.find(unitId => state.unitProgress[unitId] !== 'completed' && state.unitProgress[unitId] !== 'waived'
      && this.unit(course, unitId).prerequisites.every(id => state.unitProgress[id] === 'completed' || state.unitProgress[id] === 'waived')) ?? null
  }

  private candidatesFor(state: LearnerState, course: CourseManifest): readonly DiagnosticCandidate[] {
    const targets = state.diagnostic?.targetOutcomeIds ?? course.learningOutcomes.map(outcome => outcome.id as string)
    return buildDiagnosticCandidates(course, targets)
  }

  private waiverEligibilityFor(state: LearnerState, candidates: readonly DiagnosticCandidate[]): readonly WaiverEligibility[] {
    const byUnit = new Map<UnitId, DiagnosticCandidate[]>()
    for (const candidate of candidates) {
      const entries = byUnit.get(candidate.unitId) ?? []
      entries.push(candidate)
      byUnit.set(candidate.unitId, entries)
    }
    return Object.freeze([...byUnit].map(([unitId, unitCandidates]) => {
      const evidenceIds: EvidenceId[] = []
      const blockers: string[] = []
      let hasNonAuthored = false
      for (const candidate of unitCandidates) {
        const assessment = state.diagnostic?.assessments[candidate.candidateId]
        if (assessment === undefined) {
          blockers.push(`${candidate.rubricId}:missing`)
          continue
        }
        if (assessment.status !== 'meets' || assessment.evidenceId === undefined) {
          blockers.push(`${candidate.rubricId}:${assessment.status}`)
          continue
        }
        const evidence = state.evidence[assessment.evidenceId]
        if (evidence === undefined || !candidate.allowedEvidenceKinds.includes(evidence.kind)) {
          blockers.push(`${candidate.rubricId}:invalid-evidence`)
          continue
        }
        evidenceIds.push(evidence.evidenceId)
        if (evidence.kind === 'observed' || evidence.kind === 'machine') hasNonAuthored = true
      }
      if (!hasNonAuthored) blockers.push('unit:requires-observed-or-machine')
      return Object.freeze({
        unitId,
        eligible: blockers.length === 0,
        evidenceIds: Object.freeze(evidenceIds),
        blockers: Object.freeze(blockers),
      })
    }))
  }

  private adaptivePlan(course: CourseManifest, state: LearnerState, candidates: readonly DiagnosticCandidate[]): readonly UnitId[] {
    const targetIds = state.diagnostic?.targetOutcomeIds ?? course.learningOutcomes.map(outcome => outcome.id as string)
    const remaining = new Set(targetUnits(course, targetIds))
    const result: UnitId[] = []
    while (remaining.size > 0) {
      const available = course.units.filter(unit => remaining.has(unit.id)
        && unit.prerequisites.every(prerequisite => !remaining.has(prerequisite)))
      const next = available.sort((left, right) => {
        const leftGap = candidates.some(candidate => candidate.unitId === left.id
          && state.diagnostic?.assessments[candidate.candidateId]?.status === 'gap')
        const rightGap = candidates.some(candidate => candidate.unitId === right.id
          && state.diagnostic?.assessments[candidate.candidateId]?.status === 'gap')
        if (leftGap !== rightGap) return leftGap ? -1 : 1
        return course.units.indexOf(left) - course.units.indexOf(right)
      })[0]
      if (next === undefined) throw new TeachingError('invalid-state', 'target curriculum path has no deterministic order')
      result.push(next.id)
      remaining.delete(next.id)
    }
    return Object.freeze(result)
  }

  private async append<T extends LearningEventInput['type']>(
    scope: LearnerScope,
    sourceSessionId: SessionId,
    rootCommandId: string,
    suffix: string,
    type: T,
    data: Extract<LearningEventInput, { type: T }>['data'],
  ): Promise<LearnerState> {
    const ids = identity(rootCommandId, suffix)
    const result = await this.ctx.learner.append(scope, {
      ...ids,
      sourceSessionId,
      type,
      data,
    } as Extract<LearningEventInput, { type: T }>)
    this.states.set(scopeKey(scope), result.state)
    return result.state
  }

  async startDiagnostic(
    sessionId: SessionId,
    rootCommandId: string,
    goal: string,
    background: string,
    targetOutcomeIds?: readonly string[],
  ): Promise<DiagnosticCommandResult> {
    nonEmpty(rootCommandId, 'command_id')
    const scope = this.scopeFor(sessionId)
    const course = this.ctx.curriculum.course()
    const targets = targetOutcomeIds === undefined || targetOutcomeIds.length === 0
      ? course.learningOutcomes.map(outcome => outcome.id as string)
      : [...new Set(targetOutcomeIds.map(value => nonEmpty(value, 'target_outcome_id')))]
    const candidates = buildDiagnosticCandidates(course, targets)
    const diagnosticId = diagnosticIdentity(rootCommandId)
    let state = await this.refresh(scope)
    if (state.diagnostic?.diagnosticId === diagnosticId) {
      return Object.freeze({ state, candidates, waiverEligibility: this.waiverEligibilityFor(state, candidates) })
    }
    if (state.currentActivity !== null) throw new TeachingError('invalid-state', 'another teaching activity is already active')
    if (state.courseId === null) {
      state = await this.append(scope, sessionId, rootCommandId, 'enrollment', 'learning/enrollment-created', { courseId: course.id })
    }
    const normalizedGoal = nonEmpty(goal, 'goal')
    if (state.goal !== normalizedGoal) {
      state = await this.append(scope, sessionId, rootCommandId, 'goal', 'learning/goal-set', { goal: normalizedGoal })
    }
    state = await this.append(scope, sessionId, rootCommandId, 'diagnostic-started', 'learning/diagnostic-started', {
      diagnosticId,
      background: nonEmpty(background, 'background'),
      targetOutcomeIds: [...targets],
      candidateIds: candidates.map(candidate => candidate.candidateId),
    })
    return Object.freeze({ state, candidates, waiverEligibility: this.waiverEligibilityFor(state, candidates) })
  }

  private observedSource(candidate: DiagnosticCandidate, input: DiagnosticAssessmentInput): LearnerEvidence['source'] {
    const source = candidate.sources.find(item => item.path === input.sourcePath
      && item.anchor.kind === input.sourceAnchorKind && item.anchor.value === input.sourceAnchor)
    if (source === undefined) {
      throw new TeachingError('invalid-command', `observed evidence for candidate "${candidate.candidateId}" must reference one of its verified curriculum sources`)
    }
    return Object.freeze({ path: source.path, anchorKind: source.anchor.kind, anchor: source.anchor.value })
  }

  async submitDiagnostic(
    sessionId: SessionId,
    rootCommandId: string,
    inputs: readonly DiagnosticAssessmentInput[],
  ): Promise<DiagnosticCommandResult> {
    nonEmpty(rootCommandId, 'command_id')
    const scope = this.scopeFor(sessionId)
    const course = this.ctx.curriculum.course()
    let state = await this.refresh(scope)
    const diagnostic = state.diagnostic
    if (diagnostic === null) throw new TeachingError('invalid-state', 'there is no diagnostic to submit')
    const candidates = this.candidatesFor(state, course)
    if (diagnostic.completed) {
      return Object.freeze({ state, candidates, waiverEligibility: this.waiverEligibilityFor(state, candidates) })
    }
    const byId = new Map<string, DiagnosticAssessmentInput>()
    for (const input of inputs) {
      if (byId.has(input.candidateId)) throw new TeachingError('invalid-command', `diagnostic input repeats candidate "${input.candidateId}"`)
      byId.set(input.candidateId, input)
    }
    for (const candidate of candidates) {
      if (!byId.has(candidate.candidateId)) throw new TeachingError('invalid-command', `diagnostic input is missing candidate "${candidate.candidateId}"`)
    }
    if (byId.size !== candidates.length) throw new TeachingError('invalid-command', 'diagnostic input contains an unknown candidate')

    for (const candidate of candidates) {
      const input = byId.get(candidate.candidateId)!
      nonEmpty(input.summary, `diagnostic summary for ${candidate.candidateId}`)
      if (input.status === 'meets') {
        const kind = input.evidenceKind
        if (kind === undefined || !candidate.allowedEvidenceKinds.includes(kind)) {
          throw new TeachingError('invalid-command', `candidate "${candidate.candidateId}" requires one of: ${candidate.allowedEvidenceKinds.join(', ')}`)
        }
        if (kind === 'observed') this.observedSource(candidate, input)
        if (kind === 'machine') {
          const existing = input.existingEvidenceId === undefined ? undefined : state.evidence[EvidenceId(input.existingEvidenceId)]
          if (existing?.kind !== 'machine' || existing.unitId !== candidate.unitId || existing.attemptId === undefined) {
            throw new TeachingError('invalid-command', `machine assessment for candidate "${candidate.candidateId}" must reference committed machine evidence for the same unit`)
          }
        }
      } else if (input.evidenceKind !== undefined || input.existingEvidenceId !== undefined || input.sourcePath !== undefined
        || input.sourceAnchorKind !== undefined || input.sourceAnchor !== undefined) {
        throw new TeachingError('invalid-command', `${input.status} candidate "${candidate.candidateId}" cannot grant evidence`)
      }
    }

    const grantedEvidenceIds: EvidenceId[] = []
    for (const candidate of candidates) {
      const input = byId.get(candidate.candidateId)!
      const summary = nonEmpty(input.summary, `diagnostic summary for ${candidate.candidateId}`)
      let evidenceId: EvidenceId | undefined
      if (input.status === 'meets') {
        const kind = input.evidenceKind
        if (kind === undefined || !candidate.allowedEvidenceKinds.includes(kind)) {
          throw new TeachingError('invalid-command', `candidate "${candidate.candidateId}" requires one of: ${candidate.allowedEvidenceKinds.join(', ')}`)
        }
        let attemptId: ExerciseAttemptId | undefined
        let source: LearnerEvidence['source']
        if (kind === 'observed') source = this.observedSource(candidate, input)
        if (kind === 'machine') {
          const existing = input.existingEvidenceId === undefined ? undefined : state.evidence[EvidenceId(input.existingEvidenceId)]
          if (existing?.kind !== 'machine' || existing.unitId !== candidate.unitId || existing.attemptId === undefined) {
            throw new TeachingError('invalid-command', `machine assessment for candidate "${candidate.candidateId}" must reference committed machine evidence for the same unit`)
          }
          attemptId = existing.attemptId
        }
        evidenceId = EvidenceId(identity(rootCommandId, `diagnostic-evidence-${candidate.candidateId}`).eventId.replace('event-', 'evidence-'))
        state = await this.append(scope, sessionId, rootCommandId, `diagnostic-evidence-${candidate.candidateId}`, 'learning/evidence-recorded', {
          evidenceId,
          kind,
          summary,
          unitId: candidate.unitId,
          ...(attemptId === undefined ? {} : { attemptId }),
          diagnosticCandidateId: candidate.candidateId,
          rubricId: candidate.rubricId,
          ...(source === undefined ? {} : { source }),
        })
        grantedEvidenceIds.push(evidenceId)
      } else {
        if (input.evidenceKind !== undefined || input.existingEvidenceId !== undefined || input.sourcePath !== undefined
          || input.sourceAnchorKind !== undefined || input.sourceAnchor !== undefined) {
          throw new TeachingError('invalid-command', `${input.status} candidate "${candidate.candidateId}" cannot grant evidence`)
        }
        if (input.status === 'gap') {
          const misconceptionId = MisconceptionId(identity(rootCommandId, `diagnostic-gap-${candidate.candidateId}`).eventId.replace('event-', 'misconception-'))
          state = await this.append(scope, sessionId, rootCommandId, `diagnostic-gap-${candidate.candidateId}`, 'learning/misconception-recorded', {
            misconceptionId,
            summary,
            unitId: candidate.unitId,
          })
        }
      }
      state = await this.append(scope, sessionId, rootCommandId, `diagnostic-assessment-${candidate.candidateId}`, 'learning/diagnostic-assessed', {
        diagnosticId: diagnostic.diagnosticId,
        candidateId: candidate.candidateId,
        unitId: candidate.unitId,
        rubricId: candidate.rubricId,
        status: input.status,
        summary,
        ...(evidenceId === undefined ? {} : { evidenceId }),
      })
    }

    const eligibility = this.waiverEligibilityFor(state, candidates)
    const orderedPlan = this.adaptivePlan(course, state, candidates)
    const recommendedUnitId = orderedPlan.find(unitId => !eligibility.find(item => item.unitId === unitId)?.eligible) ?? null
    const diagnosticReason = recommendedUnitId === null
      ? 'all-target-units-eligible-for-user-requested-waiver'
      : `first-evidence-gap:${recommendedUnitId}`
    state = await this.append(scope, sessionId, rootCommandId, 'diagnostic-completed', 'learning/diagnostic-completed', {
      diagnosticId: diagnostic.diagnosticId,
      recommendedUnitId,
      evidenceIds: grantedEvidenceIds,
      reason: diagnosticReason,
    })
    state = await this.append(scope, sessionId, rootCommandId, 'diagnostic-plan', 'learning/plan-created', {
      unitIds: [...orderedPlan],
      reason: 'diagnostic-target-path-with-misconception-priority',
      evidenceIds: grantedEvidenceIds,
    })
    return Object.freeze({ state, candidates, waiverEligibility: this.waiverEligibilityFor(state, candidates) })
  }

  async waiveUnit(sessionId: SessionId, rootCommandId: string, requestedUnitId: string, reason: string): Promise<DiagnosticCommandResult> {
    nonEmpty(rootCommandId, 'command_id')
    const scope = this.scopeFor(sessionId)
    const course = this.ctx.curriculum.course()
    let state = await this.refresh(scope)
    if (state.diagnostic?.completed !== true) throw new TeachingError('invalid-state', 'unit waiver requires a completed diagnostic')
    const candidates = this.candidatesFor(state, course)
    const unitId = UnitId(nonEmpty(requestedUnitId, 'unit_id'))
    const eligibility = this.waiverEligibilityFor(state, candidates)
    const selected = eligibility.find(item => item.unitId === unitId)
    if (selected === undefined || !selected.eligible) {
      throw new TeachingError('planner-rejected', `unit "${unitId}" is not eligible for waiver: ${selected?.blockers.join(', ') ?? 'not on target path'}`)
    }
    if (state.unitProgress[unitId] === 'waived') {
      return Object.freeze({ state, candidates, waiverEligibility: eligibility })
    }
    state = await this.append(scope, sessionId, rootCommandId, `unit-waived-${unitId}`, 'learning/unit-waived', {
      unitId,
      evidenceIds: [...selected.evidenceIds],
      reason: `learner-requested:${nonEmpty(reason, 'reason')}`,
    })
    return Object.freeze({ state, candidates, waiverEligibility: this.waiverEligibilityFor(state, candidates) })
  }

  async adjustPlan(sessionId: SessionId, rootCommandId: string, requestedUnitIds: readonly string[], reason: string): Promise<LearnerState> {
    nonEmpty(rootCommandId, 'command_id')
    const scope = this.scopeFor(sessionId)
    const course = this.ctx.curriculum.course()
    let state = await this.refresh(scope)
    if (state.diagnostic?.completed !== true || state.activePlan === null) throw new TeachingError('invalid-state', 'plan adjustment requires a completed diagnostic plan')
    const unitIds = requestedUnitIds.map(value => UnitId(nonEmpty(value, 'unit_id')))
    if (unitIds.length === 0 || new Set(unitIds).size !== unitIds.length) throw new TeachingError('invalid-command', 'adjusted plan must contain unique units')
    for (const unitId of unitIds) this.unit(course, unitId)
    const required = targetUnits(course, state.diagnostic.targetOutcomeIds)
      .filter(unitId => state.unitProgress[unitId] !== 'completed' && state.unitProgress[unitId] !== 'waived')
    for (const unitId of required) {
      if (!unitIds.includes(unitId)) throw new TeachingError('planner-rejected', `adjusted plan cannot omit required target-path unit "${unitId}"`)
    }
    for (const unitId of unitIds) {
      const unit = this.unit(course, unitId)
      for (const prerequisite of unit.prerequisites) {
        if (state.unitProgress[prerequisite] !== 'completed' && state.unitProgress[prerequisite] !== 'waived'
          && (!unitIds.includes(prerequisite) || unitIds.indexOf(prerequisite) > unitIds.indexOf(unitId))) {
          throw new TeachingError('planner-rejected', `adjusted plan places unit "${unitId}" before prerequisite "${prerequisite}"`)
        }
      }
    }
    const evidenceIds = Object.values(state.diagnostic.assessments)
      .flatMap(assessment => assessment.evidenceId === undefined ? [] : [assessment.evidenceId])
    state = await this.append(scope, sessionId, rootCommandId, 'plan-adjusted', 'learning/plan-adjusted', {
      unitIds,
      reason: `learner-requested:${nonEmpty(reason, 'reason')}`,
      evidenceIds,
    })
    return state
  }

  async startUnit(sessionId: SessionId, rootCommandId: string, goal?: string, requestedUnitId?: string): Promise<LearnerState> {
    nonEmpty(rootCommandId, 'command_id')
    const scope = this.scopeFor(sessionId)
    const course = this.ctx.curriculum.course()
    let state = await this.refresh(scope)
    const normalizedGoal = state.goal === null ? nonEmpty(goal, 'goal') : undefined
    const recommended = this.recommended(state, course)
    if (recommended === null) throw new TeachingError('planner-rejected', 'the active plan has no startable incomplete unit')
    const requested = requestedUnitId === undefined ? recommended : UnitId(requestedUnitId)
    if (requested !== recommended) throw new TeachingError('planner-rejected', `unit "${requested}" is not the deterministic next unit "${recommended}"`)
    if (state.currentActivity !== null) {
      if ('unitId' in state.currentActivity && state.currentActivity.unitId === requested) return state
      throw new TeachingError('invalid-state', 'another teaching activity is already active')
    }
    if (state.courseId === null) {
      state = await this.append(scope, sessionId, rootCommandId, 'enrollment', 'learning/enrollment-created', { courseId: course.id })
    }
    if (state.goal === null) {
      state = await this.append(scope, sessionId, rootCommandId, 'goal', 'learning/goal-set', { goal: normalizedGoal! })
    }
    if (state.activePlan === null) {
      state = await this.append(scope, sessionId, rootCommandId, 'plan', 'learning/plan-created', {
        unitIds: [...topologicalUnits(course)],
        reason: 'phase-2-deterministic-prerequisite-plan',
      })
    }
    return this.append(scope, sessionId, rootCommandId, 'unit-started', 'learning/unit-started', { unitId: requested })
  }

  private resultFromPrior(state: LearnerState, rootCommandId: string): TeachingCommandResult | undefined {
    const has = (suffix: string): boolean => state.appliedEventIds.includes(identity(rootCommandId, suffix).eventId)
    if (has('unit-completed')) return Object.freeze({ outcome: 'unit-completed', state })
    if (has('feedback-retry')) return Object.freeze({ outcome: 'retry-exercise', state })
    if (has('exercise-feedback')) {
      const checks = this.currentChecks(state)
      return Object.freeze({ outcome: 'feedback-ready', state, ...(checks === undefined ? {} : { checks }) })
    }
    if (has('exercise-created')) return Object.freeze({ outcome: 'exercise-ready', state })
    if (has('explain-checkpoint')) return Object.freeze({ outcome: 'checkpoint-ready', state })
    return undefined
  }

  private currentChecks(state: LearnerState): readonly CheckResult[] | undefined {
    const activity = state.currentActivity
    if (activity === null || activity.kind === 'diagnostic' || activity.attemptId === undefined) return undefined
    return state.attempts[activity.attemptId]?.checks
  }

  async completeActivity(session: Session, rootCommandId: string, summary?: string): Promise<TeachingCommandResult> {
    nonEmpty(rootCommandId, 'command_id')
    const sessionId = session.id
    const scope = this.scopeFor(sessionId)
    const course = this.ctx.curriculum.course()
    let state = await this.refresh(scope)
    const prior = this.resultFromPrior(state, rootCommandId)
    if (prior !== undefined) return prior
    const activity = state.currentActivity
    if (activity === null || activity.kind === 'diagnostic') throw new TeachingError('invalid-state', 'there is no completable teaching activity')
    const unit = this.unit(course, activity.unitId)

    switch (activity.kind) {
      case 'explain': {
        const checkpoint = unit.checkpoints[0]
        if (checkpoint === undefined) throw new TeachingError('invalid-state', `unit "${unit.id}" has no checkpoint`)
        state = await this.append(scope, sessionId, rootCommandId, 'explain-checkpoint', 'learning/activity-advanced', {
          unitId: unit.id,
          from: 'explain',
          to: 'checkpoint',
          reason: nonEmpty(summary, 'summary'),
          checkpointId: checkpoint.id,
        })
        return Object.freeze({ outcome: 'checkpoint-ready', state })
      }
      case 'checkpoint': {
        const authoredId = EvidenceId(identity(rootCommandId, 'checkpoint-evidence').eventId.replace('event-', 'evidence-'))
        state = await this.append(scope, sessionId, rootCommandId, 'checkpoint-evidence', 'learning/evidence-recorded', {
          evidenceId: authoredId,
          kind: 'authored',
          summary: nonEmpty(summary, 'summary'),
          unitId: unit.id,
        })
        const exercise = this.exercise(unit)
        const attemptId = attemptIdentity(rootCommandId)
        const request = { session, scope, unit, exercise, attemptId }
        const attempt = await this.ctx.lab.createAttempt(request)
        state = await this.append(scope, sessionId, rootCommandId, 'exercise-created', 'learning/exercise-created', {
          attemptId,
          exerciseId: exercise.id,
          unitId: unit.id,
        })
        return Object.freeze({ outcome: 'exercise-ready', state, attempt })
      }
      case 'exercise': {
        const attemptId = activity.attemptId
        if (attemptId === undefined) throw new TeachingError('invalid-state', 'exercise activity has no attempt')
        const exercise = this.exercise(unit)
        const checkEvent = identity(rootCommandId, 'checks')
        let checks: readonly CheckResult[]
        if (state.appliedEventIds.includes(checkEvent.eventId)) {
          checks = state.attempts[attemptId]?.checks ?? []
        } else {
          checks = await this.ctx.lab.runChecks({ session, scope, unit, exercise, attemptId })
          state = await this.append(scope, sessionId, rootCommandId, 'checks', 'learning/checks-completed', {
            attemptId,
            checks: checks.map(check => ({
              ...check,
              details: [...check.details],
              artifacts: [...check.artifacts],
            })),
          })
        }
        if (checks.length > 0 && checks.every(check => check.status === 'passed')) {
          const machineId = EvidenceId(identity(rootCommandId, 'machine-evidence').eventId.replace('event-', 'evidence-'))
          state = await this.append(scope, sessionId, rootCommandId, 'machine-evidence', 'learning/evidence-recorded', {
            evidenceId: machineId,
            kind: 'machine',
            summary: checks.map(check => `${check.checkId}: ${check.summary}`).join('; '),
            unitId: unit.id,
            attemptId,
          })
        }
        state = await this.append(scope, sessionId, rootCommandId, 'exercise-feedback', 'learning/activity-advanced', {
          unitId: unit.id,
          from: 'exercise',
          to: 'feedback',
          reason: checks.every(check => check.status === 'passed') ? 'machine-checks-passed' : 'machine-checks-need-feedback',
          attemptId,
        })
        return Object.freeze({ outcome: 'feedback-ready', state, checks: Object.freeze([...checks]) })
      }
      case 'feedback': {
        const attemptId = activity.attemptId
        const attempt = attemptId === undefined ? undefined : state.attempts[attemptId]
        if (attemptId === undefined || attempt === undefined || attempt.checks.length === 0) {
          throw new TeachingError('invalid-state', 'feedback activity has no completed checks')
        }
        const machine = Object.values(state.evidence).find(evidence => evidence.kind === 'machine' && evidence.unitId === unit.id && evidence.attemptId === attemptId)
        if (attempt.checks.every(check => check.status === 'passed') && machine !== undefined) {
          const evidenceIds = Object.values(state.evidence).filter(evidence => evidence.unitId === unit.id).map(evidence => evidence.evidenceId)
          state = await this.append(scope, sessionId, rootCommandId, 'mastery', 'learning/mastery-changed', {
            unitId: unit.id,
            level: 'mastered',
            evidenceIds,
            reason: nonEmpty(summary, 'summary'),
          })
          state = await this.append(scope, sessionId, rootCommandId, 'unit-completed', 'learning/unit-completed', { unitId: unit.id, evidenceIds })
          return Object.freeze({ outcome: 'unit-completed', state, checks: attempt.checks })
        }
        state = await this.append(scope, sessionId, rootCommandId, 'feedback-retry', 'learning/activity-advanced', {
          unitId: unit.id,
          from: 'feedback',
          to: 'exercise',
          reason: attempt.checks.some(check => check.status === 'blocked') ? 'retry-after-blocked-checks' : 'retry-after-failed-checks',
          attemptId,
        })
        return Object.freeze({ outcome: 'retry-exercise', state, checks: attempt.checks })
      }
    }
  }

}

export default TeachingService
