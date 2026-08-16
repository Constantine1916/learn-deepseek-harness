import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  CommandId,
  EnrollmentId,
  EventId,
  LearnerId,
} from '@learn-dsh/learner-memory'
import LocalLearnerMemory from '@learn-dsh/learner-memory/local'

const [mode, root] = process.argv.slice(2)
if ((mode !== 'write' && mode !== 'read') || root === undefined) throw new Error('usage: process.ts <write|read> <root>')

const ctx = new Context()
await ctx.plugin(LocalLearnerMemory, { root })
const scope = { learnerId: LearnerId('process-learner'), enrollmentId: EnrollmentId('process-enrollment') }
try {
  if (mode === 'write') {
    await ctx.learnerMemory.append({
      ...scope,
      eventId: EventId('process-event'),
      commandId: CommandId('process-command'),
      sourceSessionId: SessionId('process-session'),
      type: 'learning/goal-set',
      version: 1,
      data: { goal: 'survive restart' },
    })
    await ctx.learnerMemory.flush(scope)
  }
  const events = await ctx.learnerMemory.read(scope)
  process.stdout.write(`${JSON.stringify(events)}\n`)
} finally {
  await ctx.fiber.dispose()
}
