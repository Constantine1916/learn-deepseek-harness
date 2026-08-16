#!/usr/bin/env node

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@learn-dsh/curriculum'
import type {} from '@learn-dsh/teacher'

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = resolve(directory, 'cordis.yml')
const ctx = await boot('learn-dsh-headless', configPath)

try {
  const assembly = await ctx.systemPrompt.assemble()
  const course = ctx.curriculum.course()
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
  }, undefined, 2)}\n`)
} finally {
  await ctx.fiber.dispose()
}
