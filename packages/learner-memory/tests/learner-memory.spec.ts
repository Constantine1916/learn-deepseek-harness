import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  CommandId,
  EnrollmentId,
  EventId,
  LEARNER_EVENT_VERSION,
  LearnerId,
  LearnerMemoryError,
  type LearnerEventDraft,
  type LearnerScope,
} from '@learn-dsh/learner-memory'
import LocalLearnerMemory from '@learn-dsh/learner-memory/local'

const scope: LearnerScope = {
  learnerId: LearnerId('learner-1'),
  enrollmentId: EnrollmentId('enrollment-1'),
}

function draft(overrides: Partial<LearnerEventDraft> = {}): LearnerEventDraft {
  return {
    ...scope,
    eventId: EventId('event-1'),
    commandId: CommandId('command-1'),
    sourceSessionId: SessionId('session-1'),
    type: 'learning/goal-set',
    version: LEARNER_EVENT_VERSION,
    data: { goal: 'Learn plugins' },
    ...overrides,
  }
}

async function withRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), 'learn-dsh-memory-'))
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function provider(root: string): Promise<{ ctx: Context, fiber: Awaited<ReturnType<Context['plugin']>> }> {
  const ctx = new Context()
  const fiber = await ctx.plugin(LocalLearnerMemory, { root })
  return { ctx, fiber }
}

describe('F-010 learner-memory durable append and idempotence', () => {
  it('survives an actual process restart with the same committed prefix', () => withRoot(async root => {
    const fixture = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/process.ts')
    const run = (mode: 'write' | 'read') => spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), fixture, mode, root], {
      encoding: 'utf8',
    })
    const written = run('write')
    expect(written.status, written.stderr).toBe(0)
    const reloaded = run('read')
    expect(reloaded.status, reloaded.stderr).toBe(0)
    expect(JSON.parse(reloaded.stdout)).toEqual(JSON.parse(written.stdout))
    expect(JSON.parse(reloaded.stdout)).toHaveLength(1)
  }))

  it('persists before success, flushes, and reloads the same immutable prefix after restart', () => withRoot(async root => {
    const first = await provider(root)
    const committed = await first.ctx.learnerMemory.append(draft())
    await first.ctx.learnerMemory.flush(scope)
    expect(committed).toMatchObject({ appended: true, event: { seq: 0, type: 'learning/goal-set' } })
    expect(Object.isFrozen(committed.event)).toBe(true)
    const location = first.ctx.learnerMemory.locate(scope)
    expect(await readFile(location!, 'utf8')).toContain('"eventId":"event-1"')
    await first.fiber.dispose()
    await first.ctx.fiber.dispose()

    const second = await provider(root)
    const reloaded = await second.ctx.learnerMemory.read(scope)
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]).toEqual(committed.event)
    expect(Object.isFrozen(reloaded)).toBe(true)
    await second.ctx.fiber.dispose()
  }))

  it('deduplicates stable EventId or CommandId and rejects conflicting retries', () => withRoot(async root => {
    const { ctx } = await provider(root)
    const first = await ctx.learnerMemory.append(draft())
    const byEvent = await ctx.learnerMemory.append(draft())
    const byCommand = await ctx.learnerMemory.append(draft({ eventId: EventId('event-2') }))

    expect(first.appended).toBe(true)
    expect(byEvent).toEqual({ event: first.event, appended: false })
    expect(byCommand).toEqual({ event: first.event, appended: false })
    await expect(ctx.learnerMemory.append(draft({ data: { goal: 'Different goal' } }))).rejects.toMatchObject({ code: 'idempotency-conflict' })
    expect(await ctx.learnerMemory.read(scope)).toHaveLength(1)
    await ctx.fiber.dispose()
  }))

  it('isolates learner and enrollment streams into distinct artifacts', () => withRoot(async root => {
    const { ctx } = await provider(root)
    const otherEnrollment = { learnerId: scope.learnerId, enrollmentId: EnrollmentId('enrollment-2') }
    const otherLearner = { learnerId: LearnerId('learner-2'), enrollmentId: scope.enrollmentId }
    await Promise.all([
      ctx.learnerMemory.append(draft()),
      ctx.learnerMemory.append(draft({ ...otherEnrollment, eventId: EventId('event-2'), commandId: CommandId('command-2') })),
      ctx.learnerMemory.append(draft({ ...otherLearner, eventId: EventId('event-3'), commandId: CommandId('command-3') })),
    ])
    await ctx.learnerMemory.flush()

    expect(new Set([
      ctx.learnerMemory.locate(scope),
      ctx.learnerMemory.locate(otherEnrollment),
      ctx.learnerMemory.locate(otherLearner),
    ]).size).toBe(3)
    expect(await ctx.learnerMemory.read(scope)).toHaveLength(1)
    expect(await ctx.learnerMemory.read(otherEnrollment)).toHaveLength(1)
    expect(await ctx.learnerMemory.read(otherLearner)).toHaveLength(1)
    await ctx.fiber.dispose()
  }))

  it('rejects non-JSON payloads and unsafe configured roots before writing', async () => {
    await withRoot(async root => {
      const { ctx } = await provider(root)
      expect(() => ctx.learnerMemory.append(draft({ data: { bad: Number.NaN } }))).toThrow(/invalid JSON number/)
      expect(await ctx.learnerMemory.read(scope)).toHaveLength(0)
      await ctx.fiber.dispose()
    })

    const homeCtx = new Context()
    await expect(homeCtx.plugin(LocalLearnerMemory, { root: homedir() })).rejects.toMatchObject({ code: 'unsafe-root' })
    await homeCtx.fiber.dispose()

    await withRoot(async forbidden => {
      const ctx = new Context()
      await expect(ctx.plugin(LocalLearnerMemory, { root: resolve(forbidden, 'child'), forbiddenRoots: [forbidden] })).rejects.toMatchObject({ code: 'unsafe-root' })
      await ctx.fiber.dispose()
    })
  })
})

describe('F-011 Q-002 learner-memory corruption diagnostics', () => {
  it.each([
    ['invalid JSON', '{not json\n', 'corrupt'],
    ['torn record', '{"eventId":"event-1"}', 'corrupt'],
  ])('rejects %s instead of returning an empty history', async (_label, content, code) => withRoot(async root => {
    const first = await provider(root)
    const location = first.ctx.learnerMemory.locate(scope)!
    await first.ctx.fiber.dispose()
    await mkdir(dirname(location), { recursive: true })
    await writeFile(location, content, { flag: 'w' })

    const second = await provider(root)
    await expect(second.ctx.learnerMemory.read(scope)).rejects.toMatchObject({ code })
    await second.ctx.fiber.dispose()
  }))

  it('diagnoses sequence gaps, unsupported versions, identity mismatches, and duplicate ids', () => withRoot(async root => {
    const cases = [
      [{ ...draft(), seq: 2, time: 1 }, 'sequence-gap'],
      [{ ...draft(), seq: 0, time: 1, version: 1 }, 'unsupported-version'],
      [{ ...draft(), seq: 0, time: 1, learnerId: LearnerId('other') }, 'identity-mismatch'],
      [null, 'corrupt'],
    ] as const

    for (const [record, code] of cases) {
      const first = await provider(root)
      const location = first.ctx.learnerMemory.locate(scope)!
      await first.ctx.fiber.dispose()
      await mkdir(dirname(location), { recursive: true })
      await writeFile(location, `${JSON.stringify(record)}\n`, { flag: 'w' })
      const second = await provider(root)
      await expect(second.ctx.learnerMemory.read(scope)).rejects.toMatchObject({ code })
      await second.ctx.fiber.dispose()
      await rm(location, { force: true })
    }

    const first = await provider(root)
    const location = first.ctx.learnerMemory.locate(scope)!
    await first.ctx.fiber.dispose()
    await mkdir(dirname(location), { recursive: true })
    const record = { ...draft(), seq: 0, time: 1 }
    await writeFile(location, `${JSON.stringify(record)}\n${JSON.stringify({ ...record, seq: 1 })}\n`, { flag: 'w' })
    const second = await provider(root)
    await expect(second.ctx.learnerMemory.read(scope)).rejects.toThrow(LearnerMemoryError)
    await expect(second.ctx.learnerMemory.read(scope)).rejects.toMatchObject({ code: 'corrupt' })
    await second.ctx.fiber.dispose()
  }))
})
