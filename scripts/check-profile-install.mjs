import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(root, process.env.DSH_CHECKOUT ?? '../deepseek-harness')
const bundle = resolve(root, 'packages/bundle')
const home = await mkdtemp(join(tmpdir(), 'learn-dsh-profile-'))

function dsh(args) {
  const result = spawnSync('pnpm', ['dsh', ...args], {
    cwd: checkout,
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`pnpm dsh ${args.join(' ')} failed (${String(result.status)}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return result.stdout
}

try {
  const headlessBefore = dsh(['--profile', 'headless', '--dump-config'])
  dsh(['plugin', '--profile', 'learn-dsh', 'add', bundle])
  const installed = dsh(['--profile', 'learn-dsh', '--dump-config'])
  if (!installed.includes('id: learn-dsh-teacher') || !installed.includes("name: '@learn-dsh/teacher'")) {
    throw new Error(`Installed profile did not contain the Learn DSH teacher row.\n${installed}`)
  }

  dsh(['plugin', '--profile', 'learn-dsh', 'remove', '@learn-dsh/bundle'])
  const removed = dsh(['--profile', 'learn-dsh', '--dump-config'])
  if (removed.includes('learn-dsh-teacher') || removed.includes('@learn-dsh/teacher')) {
    throw new Error(`Removed profile retained the Learn DSH teacher row.\n${removed}`)
  }
  const headlessAfter = dsh(['--profile', 'headless', '--dump-config'])
  if (headlessAfter !== headlessBefore) {
    throw new Error('Installing and removing Learn DSH changed the independent headless profile.')
  }
  process.stdout.write('Profile install, dump-config, removal, and independent headless-profile stability passed.\n')
} finally {
  await rm(home, { recursive: true, force: true })
}
