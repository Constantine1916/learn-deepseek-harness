import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches, type ProfileManifest } from '@deepseek-ai/dsh-app-boot'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('F-001 external Learn DSH bundle', () => {
  it('declares a DSH bundle patch that composes the teacher row', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as ProfileManifest
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')

    const patches = loadOverlayPatches('learn-dsh-bundle-test', resolve(root, 'cordis.patch.yml'))
    const entries = composeEntries([patches])
    expect(entries.map(({ id, name, inject }) => ({ id, name, ...(inject === undefined ? {} : { inject }) }))).toEqual([
      {
        id: 'learn-dsh-curriculum',
        name: '@learn-dsh/curriculum',
      },
      {
        id: 'learn-dsh-learner-memory',
        name: '@learn-dsh/learner-memory/local',
      },
      {
        id: 'learn-dsh-learner',
        name: '@learn-dsh/learner',
      },
      {
        id: 'learn-dsh-lab',
        name: '@learn-dsh/lab/local',
      },
      {
        id: 'learn-dsh-teaching',
        name: '@learn-dsh/teaching',
      },
      {
        id: 'learn-dsh-teacher',
        name: '@learn-dsh/teacher',
        inject: ['systemPrompt', 'teaching'],
      },
      {
        id: 'learn-dsh-tool-learning',
        name: '@learn-dsh/tool-learning',
      },
    ])
  })
})
