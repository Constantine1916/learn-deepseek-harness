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

      const exercise = await ctx.tools.execute({
        signal,
        callId: CallId('checkpoint-1'),
        name: 'learning_complete_activity',
        arguments: { command_id: 'checkpoint-command', summary: 'Submitted the authored checkpoint evidence' },
        agent: owner,
      })
      expect(exercise.isError).toBe(false)
      if (exercise.isError) throw new Error(exercise.error.message)
      expect((exercise.value as { outcome: string }).outcome).toBe('exercise-ready')

      const hint = await ctx.tools.execute({
        signal,
        callId: CallId('hint-1'),
        name: 'learning_request_hint',
        arguments: { command_id: 'hint-command' },
        agent: owner,
      })
      expect(hint.isError).toBe(false)
      if (hint.isError) throw new Error(hint.error.message)
      expect(hint.value).toMatchObject({ level: 1, text: expect.any(String) })

      const report = await ctx.tools.execute({
        signal,
        callId: CallId('report-1'),
        name: 'learning_get_report',
        arguments: {},
        agent: owner,
      })
      expect(report.isError).toBe(false)
      if (report.isError) throw new Error(report.error.message)
      expect(JSON.parse((report.value as { report_json: string }).report_json)).toMatchObject({
        readUnitIds: ['plugin-context-service-effect'],
        exerciseCompletedUnitIds: [],
        diagnosticWaivedUnitIds: [],
      })

      const noOwner = await ctx.tools.execute({ signal, callId: CallId('get-no-owner'), name: 'learning_get_state', arguments: {} })
      expect(noOwner.isError).toBe(true)
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('runs curriculum-derived diagnosis and requires an explicit eligible waiver tool call', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'learn-dsh-diagnostic-tools-'))
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

      const started = await ctx.tools.execute({
        signal,
        callId: CallId('diagnostic-start'),
        name: 'learning_start_diagnostic',
        arguments: {
          command_id: 'diagnostic-start-command',
          goal: 'Contribute a bundle',
          background: 'Experienced Cordis plugin developer',
          target_outcome_ids: ['plugin-context-service-effect'],
        },
        agent: owner,
      })
      expect(started.isError).toBe(false)
      if (started.isError) throw new Error(started.error.message)
      const candidates = (started.value as { candidates: Array<{ candidate_id: string }> }).candidates
      expect(candidates).toHaveLength(2)

      const submitted = await ctx.tools.execute({
        signal,
        callId: CallId('diagnostic-submit'),
        name: 'learning_submit_diagnostic',
        arguments: {
          command_id: 'diagnostic-submit-command',
          assessments: [
            {
              candidate_id: candidates[0]!.candidate_id,
              status: 'meets',
              summary: 'Accurately distinguished the five lifecycle concepts.',
              evidence_kind: 'authored',
            },
            {
              candidate_id: candidates[1]!.candidate_id,
              status: 'meets',
              summary: 'Traced the scoped Context in the locked source.',
              evidence_kind: 'observed',
              source_path: 'vendor/cordis/src/context.ts',
              source_anchor_kind: 'export',
              source_anchor: 'Context',
            },
          ],
        },
        agent: owner,
      })
      expect(submitted.isError).toBe(false)
      if (submitted.isError) throw new Error(submitted.error.message)
      expect((submitted.value as { waiver_eligibility: Array<{ eligible: boolean }> }).waiver_eligibility[0]?.eligible).toBe(true)
      expect(JSON.parse((submitted.value as { state_snapshot: string }).state_snapshot).unitProgress['plugin-context-service-effect']).toBe('not-started')

      const waived = await ctx.tools.execute({
        signal,
        callId: CallId('diagnostic-waive'),
        name: 'learning_waive_unit',
        arguments: {
          command_id: 'diagnostic-waive-command',
          unit_id: 'plugin-context-service-effect',
          reason: 'The learner explicitly requested the evidence-backed waiver',
        },
        agent: owner,
      })
      expect(waived.isError).toBe(false)
      if (waived.isError) throw new Error(waived.error.message)
      expect(JSON.parse((waived.value as { state_snapshot: string }).state_snapshot).unitProgress['plugin-context-service-effect']).toBe('waived')
    } finally {
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
