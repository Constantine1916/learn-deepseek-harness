import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import SandboxedFileSystem from '@deepseek-ai/dsh-fs-sandbox'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SandboxBash from '@deepseek-ai/dsh-bash-sandbox'
import { describe, expect, it } from 'vitest'
import CurriculumService, { UnitId } from '@learn-dsh/curriculum'
import LocalLab from '@learn-dsh/lab/local'
import { EnrollmentId, ExerciseAttemptId, LearnerId } from '@learn-dsh/learner'

async function setup(cwd: string, workspaceRoot = '.learn-dsh/attempts') {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjection)
  await ctx.plugin(LocalSubprocess)
  await ctx.plugin(Sandbox)
  await ctx.plugin(SandboxPolicy, { mode: 'workspace-write', workspaceRoot: cwd })
  await ctx.plugin(SandboxBash, { timeoutMs: 30_000 })
  await ctx.plugin(SandboxedFileSystem, { cwd })
  await ctx.plugin(CurriculumService, { dshVersion: '0.1.2-rc.1' })
  await ctx.plugin(LocalLab, { workspaceRoot })
  return ctx
}

function session(cwd: string): Session {
  const id = SessionId('lab-session')
  return Session.create(id, undefined, { version: 0, id, createdAt: 0, isSeeded: false, cwd })
}

describe('F-007 F-008 local lab workspace and checks', () => {
  it('creates, checks, and resets one isolated attempt through DSH capabilities', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'learn-dsh-lab-'))
    const ctx = await setup(cwd)
    try {
      const unit = ctx.curriculum.unit(UnitId('plugin-context-service-effect'))
      const exercise = unit.exercises[0]!
      const request = {
        session: session(cwd),
        scope: { learnerId: LearnerId('learner-1'), enrollmentId: EnrollmentId('enrollment-1') },
        unit,
        exercise,
        attemptId: ExerciseAttemptId('attempt-1'),
      }

      const attempt = await ctx.lab.createAttempt(request)
      expect(attempt.workspacePath).toContain(resolve(cwd, '.learn-dsh/attempts'))
      expect((await ctx.lab.runChecks(request))[0]).toMatchObject({ status: 'failed', category: 'implementation' })

      const answer = await ctx.fs.resolve('answer.json', { cwd: attempt.workspacePath })
      await ctx.fs.writeText(answer, JSON.stringify({
        plugin: 'The plugin receives a scoped Context and owns registrations.',
        context: 'Context is the scoped composition boundary for the plugin fiber.',
        service: 'Service exposes a named capability consumed through ctx.',
        effect: 'Effects attach cleanup to the owning plugin fiber lifecycle.',
        typedEvent: 'Typed events coordinate peers without owning a replaceable capability.',
        disposalEvidence: 'Disposing the plugin fiber invokes the registered disposer and removes the contribution.',
        sourceRefs: ['docs/architecture.md', 'vendor/cordis/src/context.ts'],
      }), undefined, undefined, ctx.sandboxPolicy.resolve({ session: request.session }))

      expect((await ctx.lab.runChecks(request))[0]).toMatchObject({
        status: 'passed',
        artifacts: ['answer.json'],
      })

      await ctx.lab.resetAttempt(request)
      expect((await ctx.lab.runChecks(request))[0]).toMatchObject({ status: 'failed' })
    } finally {
      await ctx.fiber.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('rejects a workspace root outside the Session cwd', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'learn-dsh-lab-unsafe-'))
    const ctx = await setup(cwd, '../outside')
    try {
      const unit = ctx.curriculum.unit(UnitId('plugin-context-service-effect'))
      await expect(ctx.lab.createAttempt({
        session: session(cwd),
        scope: { learnerId: LearnerId('learner-1'), enrollmentId: EnrollmentId('enrollment-1') },
        unit,
        exercise: unit.exercises[0]!,
        attemptId: ExerciseAttemptId('attempt-unsafe'),
      })).rejects.toMatchObject({ code: 'unsafe-path' })
    } finally {
      await ctx.fiber.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it('classifies implementation failure and configuration, environment, and safety blocks', async () => {
    const cwd = await mkdtemp(resolve(tmpdir(), 'learn-dsh-lab-categories-'))
    const ctx = await setup(cwd)
    try {
      const unit = ctx.curriculum.unit(UnitId('plugin-context-service-effect'))
      const exercise = unit.exercises[0]!
      const request = {
        session: session(cwd),
        scope: { learnerId: LearnerId('learner-categories'), enrollmentId: EnrollmentId('enrollment-categories') },
        unit,
        exercise,
        attemptId: ExerciseAttemptId('attempt-categories'),
      }
      const attempt = await ctx.lab.createAttempt(request)
      expect((await ctx.lab.runChecks(request))[0]).toMatchObject({ status: 'failed', category: 'implementation' })

      const baseCheck = exercise.checks[0]!
      const configuration = await ctx.lab.runChecks({
        ...request,
        exercise: { ...exercise, checks: [{ ...baseCheck, entry: 'missing-check.mjs' }] },
      })
      expect(configuration[0]).toMatchObject({ status: 'blocked', category: 'configuration' })

      const hanging = await ctx.fs.resolve('hanging-check.mjs', { cwd: attempt.workspacePath })
      await ctx.fs.writeText(
        hanging,
        'while (true) {}\n',
        undefined,
        undefined,
        ctx.sandboxPolicy.resolve({ session: request.session }),
      )
      const environment = await ctx.lab.runChecks({
        ...request,
        exercise: { ...exercise, checks: [{ ...baseCheck, entry: 'hanging-check.mjs', timeoutMs: 20 }] },
      })
      expect(environment[0]).toMatchObject({ status: 'blocked', category: 'environment' })

      const safety = await ctx.lab.runChecks({
        ...request,
        exercise: { ...exercise, checks: [{ ...baseCheck, entry: '../outside-check.mjs' }] },
      })
      expect(safety[0]).toMatchObject({ status: 'blocked', category: 'safety' })
    } finally {
      await ctx.fiber.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
