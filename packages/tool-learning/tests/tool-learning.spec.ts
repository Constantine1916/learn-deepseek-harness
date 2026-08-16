import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import CurriculumService from '@learn-dsh/curriculum'
import Lab, { type LabAttemptRequest } from '@learn-dsh/lab'
import LearnerService, { type CheckResult } from '@learn-dsh/learner'
import LocalLearnerMemory from '@learn-dsh/learner-memory/local'
import TeachingService from '@learn-dsh/teaching'
import * as ToolLearning from '@learn-dsh/tool-learning'

class FakeLab extends Lab {
  override createAttempt(request: LabAttemptRequest) {
    return Promise.resolve({
      attemptId: request.attemptId,
      exerciseId: request.exercise.id,
      unitId: request.unit.id,
      workspacePath: `/attempts/${request.attemptId}`,
    })
  }
  override resetAttempt(request: LabAttemptRequest) { return this.createAttempt(request) }
  override runChecks(): Promise<readonly CheckResult[]> { return Promise.resolve([]) }
}

function agent(): Agent {
  const id = SessionId('tool-session')
  const session = Session.create(id, undefined, { version: 0, id, createdAt: 0, cwd: '/tmp/learn-dsh' })
  return { id, session } as Agent
}

describe('F-005 F-010 P2-03 learning tools', () => {
  it('exposes committed state and advances only through the teaching Service', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'learn-dsh-tools-'))
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(CurriculumService, { dshVersion: '0.1.0-rc.5' })
      await ctx.plugin(LocalLearnerMemory, { root })
      await ctx.plugin(LearnerService)
      await ctx.plugin(FakeLab)
      await ctx.plugin(TeachingService, { learnerId: 'learner-1', enrollmentId: 'enrollment-1' })
      await ctx.plugin(ToolLearning)
      const owner = agent()
      const signal = new AbortController().signal

      const initial = await ctx.tools.execute({ signal, callId: CallId('get-1'), name: 'learning_get_state', arguments: {}, agent: owner })
      expect(initial.isError).toBe(false)
      if (initial.isError) throw new Error(initial.error.message)
      expect(JSON.parse((initial.value as { state_snapshot: string }).state_snapshot)).toMatchObject({ lastSeq: -1 })

      const started = await ctx.tools.execute({
        signal,
        callId: CallId('start-1'),
        name: 'learning_start_unit',
        arguments: { command_id: 'start-command', goal: 'Understand DSH lifecycle' },
        agent: owner,
      })
      expect(started.isError).toBe(false)
      if (started.isError) throw new Error(started.error.message)
      expect(JSON.parse((started.value as { state_snapshot: string }).state_snapshot).currentActivity.kind).toBe('explain')

      const advanced = await ctx.tools.execute({
        signal,
        callId: CallId('complete-1'),
        name: 'learning_complete_activity',
        arguments: { command_id: 'explain-command', summary: 'Explained the lifecycle using current sources' },
        agent: owner,
      })
      expect(advanced.isError).toBe(false)
      if (advanced.isError) throw new Error(advanced.error.message)
      expect((advanced.value as { outcome: string }).outcome).toBe('checkpoint-ready')

      const noOwner = await ctx.tools.execute({ signal, callId: CallId('get-no-owner'), name: 'learning_get_state', arguments: {} })
      expect(noOwner.isError).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
