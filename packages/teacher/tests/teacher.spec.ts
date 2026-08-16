import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as Teacher from '@learn-dsh/teacher'

describe('F-001 F-002 Q-001 teacher prompt contribution', () => {
  it('registers one teacher section and removes it with its plugin fiber', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    const teacherFiber = await ctx.plugin(Teacher)

    const active = await ctx.systemPrompt.assemble()
    expect(active.sections).toContainEqual({
      name: Teacher.TEACHER_SECTION_NAME,
      text: Teacher.TEACHER_PROMPT,
    })
    expect(renderPrompt(active)).toContain('You are Learn DeepSeek Harness')

    await teacherFiber.dispose()

    const disposed = await ctx.systemPrompt.assemble()
    expect(disposed.sections.map(section => section.name)).not.toContain(Teacher.TEACHER_SECTION_NAME)
    expect(renderPrompt(disposed)).not.toContain('You are Learn DeepSeek Harness')
  })
})
