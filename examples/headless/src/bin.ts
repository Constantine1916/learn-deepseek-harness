#!/usr/bin/env node

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { CourseId, UnitId } from '@learn-dsh/curriculum'
import {
  CommandId,
  EnrollmentId,
  EventId,
  LearnerId,
} from '@learn-dsh/learner'
import type {} from '@learn-dsh/teacher'

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = resolve(directory, 'cordis.yml')
const temporaryHome = process.env.DSH_HOME === undefined
  ? await mkdtemp(resolve(tmpdir(), 'learn-dsh-example-'))
  : undefined
if (temporaryHome !== undefined) process.env.DSH_HOME = temporaryHome
const ctx = await boot('learn-dsh-headless', configPath)

try {
  const assembly = await ctx.systemPrompt.assemble()
  const course = ctx.curriculum.course()
  const scope = {
    learnerId: LearnerId('snapshot-learner'),
    enrollmentId: EnrollmentId('snapshot-enrollment'),
  }
  const sourceSessionId = SessionId('snapshot-session')
  await ctx.learner.createEnrollment(scope, {
    eventId: EventId('snapshot-event-1'),
    commandId: CommandId('snapshot-command-1'),
    sourceSessionId,
    data: { courseId: CourseId('dsh-foundations') },
  })
  await ctx.learner.append(scope, {
    eventId: EventId('snapshot-event-2'),
    commandId: CommandId('snapshot-command-2'),
    sourceSessionId,
    type: 'learning/goal-set',
    data: { goal: 'Understand DSH plugin composition' },
  })
  await ctx.learner.append(scope, {
    eventId: EventId('snapshot-event-3'),
    commandId: CommandId('snapshot-command-3'),
    sourceSessionId,
    type: 'learning/plan-created',
    data: { unitIds: [UnitId('plugin-context-service-effect')], reason: 'first-foundations-unit' },
  })
  await ctx.learner.append(scope, {
    eventId: EventId('snapshot-event-4'),
    commandId: CommandId('snapshot-command-4'),
    sourceSessionId,
    type: 'learning/unit-started',
    data: { unitId: UnitId('plugin-context-service-effect') },
  })
  await ctx.learner.flush(scope)
  const learnerState = await ctx.learner.getState(scope)
  const memoryEvents = await ctx.learnerMemory.read(scope)
  process.stdout.write(`${JSON.stringify({
    sections: assembly.sections,
    prompt: renderPrompt(assembly),
    curriculum: {
      id: course.id,
      version: course.version,
      dshVersionRange: course.dshVersionRange,
      units: course.units.map(unit => ({
        id: unit.id,
        title: unit.title,
        prerequisites: unit.prerequisites,
        contentEntry: unit.contentEntry,
      })),
      sourceVerification: ctx.curriculum.sourceVerification,
    },
    learnerMemory: {
      eventCount: memoryEvents.length,
      state: learnerState,
    },
  }, undefined, 2)}\n`)
} finally {
  await ctx.fiber.dispose()
  if (temporaryHome !== undefined) await rm(temporaryHome, { recursive: true, force: true })
}
