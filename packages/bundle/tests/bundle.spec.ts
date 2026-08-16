import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { composeEntries, type ProfileManifest } from '@deepseek-ai/dsh-app-boot'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('F-001 external Learn DSH bundle', () => {
  it('declares a DSH bundle patch that composes the teacher row', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as ProfileManifest
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')

    const patches = load(readFileSync(resolve(root, 'cordis.patch.yml'), 'utf8')) as Parameters<typeof composeEntries>[0][number]
    expect(composeEntries([patches])).toEqual([
      {
        id: 'learn-dsh-teacher',
        name: '@learn-dsh/teacher',
        inject: ['systemPrompt'],
      },
    ])
  })
})
