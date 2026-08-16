import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import CurriculumService, { CourseId, UnitId } from '@learn-dsh/curriculum'
import LearnerService, {
  CommandId,
  DiagnosticCandidateId,
  DiagnosticId,
  EnrollmentId,
  EventId,
  EvidenceId,
  ExerciseAttemptId,
  LearnerId,
  LearnerProjectionError,
  MisconceptionId,
  projectLearnerState,
  type LearningEventInput,
} from '@learn-dsh/learner'
import LocalLearnerMemory from '@learn-dsh/learner-memory/local'
import type { LearnerScope } from '@learn-dsh/learner-memory'

const learnerId = LearnerId('learner-1')
const enrollmentId = EnrollmentId('enrollment-1')
const scope: LearnerScope = { learnerId, enrollmentId }
const courseId = CourseId('dsh-foundations')
const unitId = UnitId('plugin-context-service-effect')
const session1 = SessionId('session-1')
const session2 = SessionId('session-2')

let nextIdentity = 0
function input<T extends LearningEventInput['type']>(
  type: T,
  data: Extract<LearningEventInput, { type: T }>['data'],
  sourceSessionId = session1,
): Extract<LearningEventInput, { type: T }> {
  nextIdentity += 1
  return {
    eventId: EventId(`event-${String(nextIdentity)}`),
    commandId: CommandId(`command-${String(nextIdentity)}`),
    sourceSessionId,
    type,
    data,
  } as Extract<LearningEventInput, { type: T }>
}

async function setup(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(CurriculumService, { dshVersion: '0.1.0-rc.5' })
  await ctx.plugin(LocalLearnerMemory, { root })
  await ctx.plugin(LearnerService)
  return ctx
}

async function withContext<T>(run: (ctx: Context, root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), 'learn-dsh-learner-'))
  const ctx = await setup(root)
  nextIdentity = 0
  try {
    return await run(ctx, root)
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}

async function createEnrollment(ctx: Context, target: LearnerScope = scope): Promise<void> {
  await ctx.learner.createEnrollment(target, input('learning/enrollment-created', { courseId }))
}

describe('F-010 learner events and pure projection', () => {
  it('projects every Phase 1 learning event branch into deterministic immutable state', () => withContext(async ctx => {
    await createEnrollment(ctx)
    await ctx.learner.append(scope, input('learning/goal-set', { goal: 'Build a DSH plugin' }))
    const namesCandidate = DiagnosticCandidateId('diagnostic-plugin-context-service-effect-names-roles')
    const disposalCandidate = DiagnosticCandidateId('diagnostic-plugin-context-service-effect-traces-disposal')
    await ctx.learner.append(scope, input('learning/diagnostic-started', {
      diagnosticId: DiagnosticId('diagnostic-1'),
      background: 'TypeScript developer new to DSH',
      targetOutcomeIds: ['plugin-context-service-effect'],
      candidateIds: [namesCandidate, disposalCandidate],
    }))
    await ctx.learner.append(scope, input('learning/evidence-recorded', {
      evidenceId: EvidenceId('diagnostic-evidence-1'), kind: 'authored', summary: 'Explained the five roles', unitId,
      diagnosticCandidateId: namesCandidate, rubricId: 'names-roles',
    }))
    await ctx.learner.append(scope, input('learning/diagnostic-assessed', {
      diagnosticId: DiagnosticId('diagnostic-1'), candidateId: namesCandidate, unitId, rubricId: 'names-roles',
      status: 'meets', summary: 'Roles are accurate', evidenceId: EvidenceId('diagnostic-evidence-1'),
    }))
    await ctx.learner.append(scope, input('learning/evidence-recorded', {
      evidenceId: EvidenceId('diagnostic-evidence-2'), kind: 'observed', summary: 'Located disposal ownership', unitId,
      diagnosticCandidateId: disposalCandidate, rubricId: 'traces-disposal',
      source: { path: 'vendor/cordis/src/context.ts', anchorKind: 'export', anchor: 'Context' },
    }))
    await ctx.learner.append(scope, input('learning/diagnostic-assessed', {
      diagnosticId: DiagnosticId('diagnostic-1'), candidateId: disposalCandidate, unitId, rubricId: 'traces-disposal',
      status: 'meets', summary: 'Source trace is valid', evidenceId: EvidenceId('diagnostic-evidence-2'),
    }))
    await ctx.learner.append(scope, input('learning/diagnostic-completed', {
      diagnosticId: DiagnosticId('diagnostic-1'), recommendedUnitId: null,
      evidenceIds: [EvidenceId('diagnostic-evidence-1'), EvidenceId('diagnostic-evidence-2')], reason: 'all-rubric-met',
    }))
    await ctx.learner.append(scope, input('learning/plan-created', {
      unitIds: [unitId], reason: 'foundation-first',
      evidenceIds: [EvidenceId('diagnostic-evidence-1'), EvidenceId('diagnostic-evidence-2')],
    }))
    await ctx.learner.append(scope, input('learning/plan-adjusted', { unitIds: [unitId], reason: 'keep-current-plan' }))
    await ctx.learner.append(scope, input('learning/unit-started', { unitId }))
    await ctx.learner.append(scope, input('learning/activity-advanced', {
      unitId, from: 'explain', to: 'checkpoint', reason: 'explanation-observed', checkpointId: 'explain-lifecycle',
    }))
    await ctx.learner.append(scope, input('learning/evidence-recorded', {
      evidenceId: EvidenceId('evidence-1'), kind: 'observed', summary: 'Located Context and Service', unitId,
    }))
    await ctx.learner.append(scope, input('learning/exercise-created', {
      attemptId: ExerciseAttemptId('attempt-1'), exerciseId: 'trace-minimal-plugin', unitId,
    }))
    await ctx.learner.append(scope, input('learning/checks-completed', {
      attemptId: ExerciseAttemptId('attempt-1'),
      checks: [{
        checkId: 'trace', status: 'passed', category: 'implementation', summary: 'Lifecycle traced',
        details: ['trace.json is valid'], artifacts: ['trace.json'],
      }],
    }))
    await ctx.learner.append(scope, input('learning/activity-advanced', {
      unitId, from: 'exercise', to: 'feedback', reason: 'checks-completed', attemptId: ExerciseAttemptId('attempt-1'),
    }))
    await ctx.learner.append(scope, input('learning/hint-used', { attemptId: ExerciseAttemptId('attempt-1'), level: 1 }))
    await ctx.learner.append(scope, input('learning/misconception-recorded', {
      misconceptionId: MisconceptionId('misconception-1'), summary: 'Confused Service with Provider', unitId,
    }))
    await ctx.learner.append(scope, input('learning/mastery-changed', {
      unitId, level: 'mastered', evidenceIds: [EvidenceId('evidence-1')], reason: 'machine-and-source-evidence',
    }))
    const beforeRejectedCompletion = await ctx.learnerMemory.read(scope)
    await expect(ctx.learner.append(scope, input('learning/unit-completed', { unitId, evidenceIds: [EvidenceId('evidence-1')] })))
      .rejects.toMatchObject({ code: 'illegal-transition' })
    expect(await ctx.learnerMemory.read(scope)).toEqual(beforeRejectedCompletion)

    await ctx.learner.append(scope, input('learning/evidence-recorded', {
      evidenceId: EvidenceId('evidence-2'), kind: 'machine', summary: 'Lifecycle check passed', unitId,
      attemptId: ExerciseAttemptId('attempt-1'),
    }))
    await ctx.learner.append(scope, input('learning/mastery-changed', {
      unitId, level: 'mastered', evidenceIds: [EvidenceId('evidence-1'), EvidenceId('evidence-2')], reason: 'machine-and-source-evidence',
    }))
    const completionEvidence = [EvidenceId('evidence-1'), EvidenceId('evidence-2')]
    await ctx.learner.append(scope, input('learning/unit-completed', { unitId, evidenceIds: completionEvidence }))
    const result = await ctx.learner.append(scope, input('learning/course-completed', { courseId, evidenceIds: completionEvidence }))

    expect(result.state).toMatchObject({
      goal: 'Build a DSH plugin',
      courseCompleted: true,
      unitProgress: { [unitId]: 'completed' },
      mastery: { [unitId]: { level: 'mastered' } },
      nextRecommendation: { unitId: null, reason: 'course-complete' },
    })
    expect(result.state.activePlan?.revision).toBe(2)
    expect(result.state.attempts['attempt-1']).toMatchObject({ hintLevels: [1], checks: [{ status: 'passed' }] })
    expect(result.state.misconceptions['misconception-1']?.resolved).toBe(false)
    expect(Object.isFrozen(result.state)).toBe(true)
    expect(Object.isFrozen(result.state.attempts)).toBe(true)
  }))

  it('replays an identical EventId once and rejects conflicting or illegal transitions before persistence', () => withContext(async ctx => {
    const created = input('learning/enrollment-created', { courseId })
    const first = await ctx.learner.createEnrollment(scope, created)
    const repeated = await ctx.learner.createEnrollment(scope, created)
    expect(first.appended).toBe(true)
    expect(repeated.appended).toBe(false)
    expect(repeated.state.appliedEventIds).toHaveLength(1)

    const before = await ctx.learnerMemory.read(scope)
    await expect(ctx.learner.append(scope, input('learning/hint-used', {
      attemptId: ExerciseAttemptId('missing-attempt'), level: 1,
    }))).rejects.toMatchObject({ code: 'illegal-transition' })
    expect(await ctx.learnerMemory.read(scope)).toEqual(before)

    await expect(ctx.learner.createEnrollment(scope, {
      ...created,
      data: { courseId: CourseId('different-course') },
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
  }))

  it('keeps the pure fold stable when the exact same envelope is replayed twice', () => withContext(async ctx => {
    await createEnrollment(ctx)
    const events = await ctx.learnerMemory.read(scope)
    const course = ctx.curriculum.course()
    expect(projectLearnerState(scope, [events[0]!, events[0]!], course).appliedEventIds).toEqual([events[0]!.eventId])
    expect(() => projectLearnerState(scope, [{ ...events[0]!, seq: 1 }], course)).toThrow(LearnerProjectionError)
  }))
})

describe('F-011 enrollment continuity, isolation, and Provider requirements', () => {
  it('continues one enrollment across Sessions and process restart without leaking to other scopes', () => withContext(async (ctx, root) => {
    await createEnrollment(ctx)
    await ctx.learner.append(scope, input('learning/goal-set', { goal: 'Cross-session goal' }, session1))
    await ctx.learner.append(scope, input('learning/plan-created', { unitIds: [unitId], reason: 'continue' }, session2))
    const live = await ctx.learner.getState(scope)
    expect(live.sourceSessionIds).toEqual([session1, session2])
    expect(live.goal).toBe('Cross-session goal')

    const otherEnrollment = { learnerId, enrollmentId: EnrollmentId('enrollment-2') }
    const otherLearner = { learnerId: LearnerId('learner-2'), enrollmentId }
    expect((await ctx.learner.getState(otherEnrollment)).lastSeq).toBe(-1)
    expect((await ctx.learner.getState(otherLearner)).lastSeq).toBe(-1)

    await ctx.fiber.dispose()
    const restarted = await setup(root)
    try {
      const restored = await restarted.learner.getState(scope)
      expect(restored).toEqual(live)
      expect((await restarted.learner.getState(otherEnrollment)).goal).toBeNull()
    } finally {
      await restarted.fiber.dispose()
    }
  }))

  it('keeps the learner Service unavailable when the required memory Provider is absent', async () => {
    const ctx = new Context()
    await ctx.plugin(CurriculumService, { dshVersion: '0.1.0-rc.5' })
    await ctx.plugin(LearnerService)
    expect(ctx.get('learner')).toBeUndefined()
    await ctx.fiber.dispose()
  })
})
