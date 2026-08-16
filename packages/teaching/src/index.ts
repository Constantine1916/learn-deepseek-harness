/** Deterministic planner and Phase 2 teaching activity state machine. */

import { createHash } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import { UnitId, type CourseManifest, type CurriculumExercise, type CurriculumUnit } from '@learn-dsh/curriculum'
import type { LabAttempt } from '@learn-dsh/lab'
import {
  CommandId,
  EnrollmentId,
  EventId,
  EvidenceId,
  ExerciseAttemptId,
  LearnerId,
  type CheckResult,
  type LearnerState,
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
    return plan.find(unitId => state.unitProgress[unitId] !== 'completed'
      && this.unit(course, unitId).prerequisites.every(id => state.unitProgress[id] === 'completed')) ?? null
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
