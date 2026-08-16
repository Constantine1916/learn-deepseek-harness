import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as Teacher from '@learn-dsh/teacher'

class FakeTeaching extends Service {
  constructor(ctx: Context) { super(ctx, 'teaching') }
  snapshotFor() { return { learnerId: 'learner', enrollmentId: 'enrollment', lastSeq: 3 } }
  unbindSession() {}
}

describe('F-001 F-002 F-011 Q-001 teacher prompt contribution', () => {
  it('registers one teacher section and removes it with its plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(FakeTeaching)
    const teacherFiber = await ctx.plugin(Teacher)

    const active = await ctx.systemPrompt.assemble({ agent: { id: SessionId('session') } as Agent })
    expect(active.sections).toContainEqual({
      name: Teacher.TEACHER_SECTION_NAME,
      text: Teacher.TEACHER_PROMPT,
    })
    expect(active.contexts).toContainEqual({
      name: Teacher.LEARNER_CONTEXT_NAME,
      text: expect.stringContaining('"lastSeq":3'),
    })
    expect(renderPrompt(active)).toContain('You are Learn DeepSeek Harness')

    await teacherFiber.dispose()

    const disposed = await ctx.systemPrompt.assemble()
    expect(disposed.sections.map(section => section.name)).not.toContain(Teacher.TEACHER_SECTION_NAME)
    expect(renderPrompt(disposed)).not.toContain('You are Learn DeepSeek Harness')
  })
})
