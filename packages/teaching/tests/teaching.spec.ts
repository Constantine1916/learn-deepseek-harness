import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import CurriculumService from '@learn-dsh/curriculum'
import Lab, { type LabAttemptRequest } from '@learn-dsh/lab'
import LearnerService, { EnrollmentId, LearnerId, type CheckResult } from '@learn-dsh/learner'
import LocalLearnerMemory from '@learn-dsh/learner-memory/local'
import TeachingService from '@learn-dsh/teaching'

class FakeLab extends Lab {
  createFailures = 0
  createCalls = 0
  results: CheckResult[] = [{
    checkId: 'trace-artifact',
    status: 'failed',
    category: 'implementation',
    summary: 'artifact incomplete',
    details: ['missing fields'],
    artifacts: ['answer.json'],
  }]

  override createAttempt(request: LabAttemptRequest) {
    this.createCalls += 1
    if (this.createFailures > 0) {
      this.createFailures -= 1
      return Promise.reject(new Error('injected attempt preparation failure'))
    }
    return Promise.resolve({
      attemptId: request.attemptId,
      exerciseId: request.exercise.id,
      unitId: request.unit.id,
      workspacePath: `/attempts/${request.attemptId}`,
    })
  }

  override resetAttempt(request: LabAttemptRequest) { return this.createAttempt(request) }
  override runChecks() { return Promise.resolve(this.results) }
}

function session(id: string): Session {
  const sessionId = SessionId(id)
  return Session.create(sessionId, undefined, { version: 0, id: sessionId, createdAt: 0, cwd: '/tmp/learn-dsh' })
}

async function setup(root: string): Promise<{ ctx: Context, lab: FakeLab }> {
  const ctx = new Context()
  await ctx.plugin(CurriculumService, { dshVersion: '0.1.0-rc.5' })
  await ctx.plugin(LocalLearnerMemory, { root })
  await ctx.plugin(LearnerService)
  await ctx.plugin(FakeLab)
  await ctx.plugin(TeachingService, { learnerId: 'learner-1', enrollmentId: 'enrollment-1' })
  return { ctx, lab: ctx.lab as FakeLab }
}

describe('F-005 F-006 Phase 2 deterministic teaching state machine', () => {
  it('runs explain, checkpoint, failed exercise retry, passed feedback, and idempotent completion', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'learn-dsh-teaching-'))
    const { ctx, lab } = await setup(root)
    const activeSession = session('session-1')
    try {
      let state = await ctx.teaching.startUnit(activeSession.id, 'start-1', 'Understand DSH lifecycle')
      expect(state.currentActivity).toMatchObject({ kind: 'explain' })
      expect(state.activePlan?.reason).toBe('phase-2-deterministic-prerequisite-plan')

      let result = await ctx.teaching.completeActivity(activeSession, 'explain-1', 'Explained the five responsibilities with current sources')
      expect(result.outcome).toBe('checkpoint-ready')
      expect(result.state.currentActivity).toMatchObject({ kind: 'checkpoint', checkpointId: 'explain-lifecycle' })

      result = await ctx.teaching.completeActivity(activeSession, 'checkpoint-1', 'The learner traced registration ownership and disposal ownership')
      expect(result.outcome).toBe('exercise-ready')
      expect(result.attempt?.workspacePath).toContain('/attempts/')
      expect(result.state.currentActivity).toMatchObject({ kind: 'exercise' })

      result = await ctx.teaching.completeActivity(activeSession, 'checks-failed-1', 'Run the deterministic fixture check')
      expect(result.outcome).toBe('feedback-ready')
      expect(result.checks?.[0]?.status).toBe('failed')
      expect(Object.values(result.state.evidence).some(evidence => evidence.kind === 'machine')).toBe(false)

      result = await ctx.teaching.completeActivity(activeSession, 'feedback-failed-1', 'Explain the missing artifact fields and retry')
      expect(result.outcome).toBe('retry-exercise')
      expect(result.state.currentActivity).toMatchObject({ kind: 'exercise' })

      lab.results = [{
        checkId: 'trace-artifact',
        status: 'passed',
        category: 'implementation',
        summary: 'artifact passed',
        details: ['all required fields present'],
        artifacts: ['answer.json'],
      }]
      result = await ctx.teaching.completeActivity(activeSession, 'checks-passed-1', 'Run the corrected deterministic fixture check')
      expect(result.outcome).toBe('feedback-ready')
      expect(Object.values(result.state.evidence).some(evidence => evidence.kind === 'machine')).toBe(true)

      result = await ctx.teaching.completeActivity(activeSession, 'feedback-passed-1', 'Authored reasoning and machine evidence satisfy the Phase 2 completion rule')
      expect(result.outcome).toBe('unit-completed')
      expect(result.state.unitProgress['plugin-context-service-effect']).toBe('completed')
      expect(result.state.mastery['plugin-context-service-effect']?.level).toBe('mastered')

      const replay = await ctx.teaching.completeActivity(activeSession, 'feedback-passed-1', 'ignored on idempotent retry')
      expect(replay.outcome).toBe('unit-completed')
      expect(replay.state.appliedEventIds).toEqual(result.state.appliedEventIds)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('continues the default Enrollment in another Session and isolates an explicit binding', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'learn-dsh-teaching-continuity-'))
    const { ctx } = await setup(root)
    try {
      const first = session('session-1')
      const second = session('session-2')
      const started = await ctx.teaching.startUnit(first.id, 'start-shared', 'Continue across Sessions')
      expect(await ctx.teaching.stateFor(second.id)).toEqual(started)

      await ctx.teaching.bindSession(second.id, {
        learnerId: LearnerId('learner-2'),
        enrollmentId: EnrollmentId('enrollment-2'),
      })
      expect((await ctx.teaching.stateFor(second.id)).lastSeq).toBe(-1)
      expect((await ctx.teaching.stateFor(first.id)).goal).toBe('Continue across Sessions')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('retries a partially committed checkpoint command without duplicating evidence', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'learn-dsh-teaching-partial-'))
    const { ctx, lab } = await setup(root)
    const activeSession = session('session-partial')
    try {
      await ctx.teaching.startUnit(activeSession.id, 'start-partial', 'Understand retry durability')
      await ctx.teaching.completeActivity(activeSession, 'explain-partial', 'Advance to the checkpoint')
      lab.createFailures = 1

      await expect(ctx.teaching.completeActivity(activeSession, 'checkpoint-partial', 'Persist authored evidence once'))
        .rejects.toThrow('injected attempt preparation failure')
      const partial = await ctx.teaching.stateFor(activeSession.id)
      expect(partial.currentActivity).toMatchObject({ kind: 'checkpoint' })
      expect(Object.values(partial.evidence).filter(evidence => evidence.kind === 'authored')).toHaveLength(1)

      const retried = await ctx.teaching.completeActivity(activeSession, 'checkpoint-partial', 'Persist authored evidence once')
      expect(retried.outcome).toBe('exercise-ready')
      expect(retried.state.currentActivity).toMatchObject({ kind: 'exercise' })
      expect(Object.values(retried.state.evidence).filter(evidence => evidence.kind === 'authored')).toHaveLength(1)
      expect(lab.createCalls).toBe(2)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a requested unit that is not the deterministic recommendation', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'learn-dsh-teaching-plan-'))
    const { ctx } = await setup(root)
    try {
      await expect(ctx.teaching.startUnit(session('session-plan').id, 'start-invalid', 'Goal', 'another-unit'))
        .rejects.toMatchObject({ code: 'planner-rejected' })
      expect((await ctx.teaching.stateFor(session('session-plan').id)).lastSeq).toBe(-1)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
