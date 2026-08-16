import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { composeEntries, loadOverlayPatches, type ProfileManifest } from '@deepseek-ai/dsh-app-boot'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { checkPreset, installPreset, PRESET_MARKER_FILE, removePreset } from '../src/setup.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('F-001 external Learn DSH bundle', () => {
  it('keeps host services in the bundle and model-facing plugins in the agent preset', () => {
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
    ])

    const presetPath = resolve(root, 'presets/learn-dsh/agent.cordis.yml')
    const presetEntries = yaml.load(readFileSync(presetPath, 'utf8'), { schema: entryListSchema }) as Array<{ id: string, name: string }>
    expect(presetEntries.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: 'persona', name: '@deepseek-ai/dsh-persona' },
      { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash' },
      { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh' },
      { id: 'tool-fs', name: '@deepseek-ai/dsh-tool-fs' },
      { id: 'learn-dsh-teacher', name: '@learn-dsh/teacher' },
      { id: 'learn-dsh-tool-learning', name: '@learn-dsh/tool-learning' },
    ])
  })

  it('installs, checks, repairs, removes, and reinstalls only its managed preset directory', async () => {
    const home = await mkdtemp(join(tmpdir(), 'learn-dsh-preset-test-'))
    const directory = resolve(home, '.agent-presets/learn-dsh')
    try {
      expect(await installPreset({ home })).toMatchObject({ status: 'installed', presetDirectory: directory })
      expect(await checkPreset(home)).toMatchObject({ status: 'unchanged', presetDirectory: directory })
      expect(await installPreset({ home })).toMatchObject({ status: 'unchanged' })

      await writeFile(resolve(directory, 'preset.yml'), 'name: changed\n')
      await expect(checkPreset(home)).rejects.toThrow(/differs from the packaged release/)
      await expect(installPreset({ home })).rejects.toThrow(/--force/)
      expect(await installPreset({ home, force: true })).toMatchObject({ status: 'installed' })
      await expect(checkPreset(home)).resolves.toMatchObject({ status: 'unchanged' })

      await writeFile(resolve(directory, 'user-note.txt'), 'keep me')
      await expect(removePreset(home)).rejects.toThrow(/unowned files: user-note\.txt/)
      await rm(resolve(directory, 'user-note.txt'))
      expect(await removePreset(home)).toMatchObject({ status: 'removed' })
      expect(await removePreset(home)).toMatchObject({ status: 'missing' })
      expect(await checkPreset(home)).toMatchObject({ status: 'missing' })
      expect(await installPreset({ home })).toMatchObject({ status: 'installed' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('rejects unsafe homes and preset directories it does not own', async () => {
    await expect(installPreset({ home: parse(process.cwd()).root })).rejects.toThrow(/filesystem root/)
    await expect(installPreset({ home: '   ' })).rejects.toThrow(/non-empty path/)

    const home = await mkdtemp(join(tmpdir(), 'learn-dsh-preset-conflict-'))
    const directory = resolve(home, '.agent-presets/learn-dsh')
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(resolve(directory, PRESET_MARKER_FILE), '{}\n')
      await expect(installPreset({ home })).rejects.toThrow(/not owned/)
      await expect(removePreset(home)).rejects.toThrow(/not owned/)
    } finally {
      await rm(home, { recursive: true, force: true })
    }

    const symlinkHome = await mkdtemp(join(tmpdir(), 'learn-dsh-preset-symlink-'))
    const externalRoot = await mkdtemp(join(tmpdir(), 'learn-dsh-preset-external-'))
    try {
      await symlink(externalRoot, resolve(symlinkHome, '.agent-presets'))
      await expect(installPreset({ home: symlinkHome })).rejects.toThrow(/not a real directory/)
      await expect(checkPreset(symlinkHome)).rejects.toThrow(/not a real directory/)
      await expect(removePreset(symlinkHome)).rejects.toThrow(/not a real directory/)
    } finally {
      await rm(symlinkHome, { recursive: true, force: true })
      await rm(externalRoot, { recursive: true, force: true })
    }
  })
})
