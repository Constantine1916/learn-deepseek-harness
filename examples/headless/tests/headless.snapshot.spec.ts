import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

describe('F-004 F-005 F-011 Q-006 keyless real Agent Loop teaching snapshot', () => {
  it('covers adaptive diagnosis, explicit waiver, teaching completion, and Session Log audit', async () => {
    const home = await mkdtemp(resolve(tmpdir(), 'learn-dsh-headless-'))
    try {
      const result = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), resolve(root, 'src/bin.ts')], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, DSH_HOME: home },
      })

      expect(result.status, result.stderr).toBe(0)
      expect(result.stderr).toBe('')
      await expect(result.stdout).toMatchFileSnapshot('./snapshots/headless.expected.json')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
