#!/usr/bin/env node

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import type {} from '@learn-dsh/teacher'

const directory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const configPath = resolve(directory, 'cordis.yml')
const ctx = await boot('learn-dsh-headless', configPath)

try {
  const assembly = await ctx.systemPrompt.assemble()
  process.stdout.write(`${JSON.stringify({
    sections: assembly.sections,
    prompt: renderPrompt(assembly),
  }, undefined, 2)}\n`)
} finally {
  await ctx.fiber.dispose()
}
