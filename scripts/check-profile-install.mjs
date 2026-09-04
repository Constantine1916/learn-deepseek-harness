import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cliRoot = resolve(process.env.DSH_CLI_ROOT ?? resolve(root, 'examples/headless'))
const bundle = resolve(process.env.LEARN_DSH_BUNDLE_PATH ?? resolve(root, 'packages/bundle'))
const setupBin = resolve(bundle, 'lib/setup-bin.js')
const home = await mkdtemp(join(tmpdir(), 'learn-dsh-profile-'))
const requireFromCli = createRequire(resolve(cliRoot, 'package.json'))
const dshManifestPath = requireFromCli.resolve('@deepseek-ai/dsh/package.json')
const requireFromDsh = createRequire(dshManifestPath)

function dsh(args) {
  const result = spawnSync('pnpm', ['exec', 'dsh', ...args], {
    cwd: cliRoot,
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`pnpm exec dsh ${args.join(' ')} failed (${String(result.status)}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return result.stdout
}

function setup(args) {
  const result = spawnSync(process.execPath, [setupBin, ...args, '--home', home], {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`learn-dsh-setup ${args.join(' ')} failed (${String(result.status)}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return result.stdout
}

try {
  const headlessBefore = dsh(['--profile', 'headless', '--dump-config'])
  const webBefore = dsh(['--profile', 'web', '--dump-config'])
  setup(['install'])
  setup(['check'])
  const presetDirectory = resolve(home, '.agent-presets/learn-dsh')
  await access(resolve(presetDirectory, 'agent.cordis.yml'))
  await access(resolve(presetDirectory, 'preset.yml'))
  const presetComposition = await readFile(resolve(presetDirectory, 'agent.cordis.yml'), 'utf8')
  for (const name of ['@learn-dsh/teacher', '@learn-dsh/tool-learning']) {
    if (!presetComposition.includes(`name: '${name}'`)) {
      throw new Error(`Installed preset did not contain ${name}.\n${presetComposition}`)
    }
  }
  const agentPresetsModule = await import(pathToFileURL(requireFromDsh.resolve('@deepseek-ai/dsh-agent-presets')).href)
  const discovered = await agentPresetsModule.discoverPresets(
    [{ path: resolve(home, '.agent-presets'), trust: 'user' }],
    pathToFileURL(dirname(dshManifestPath)).href,
  )
  const learnPreset = discovered.find(preset => preset.id === 'learn-dsh')
  if (learnPreset === undefined || learnPreset.broken !== undefined || learnPreset.name !== 'Learn DSH') {
    throw new Error(`DSH agent-preset roster did not discover a healthy Learn DSH preset.\n${JSON.stringify(discovered, null, 2)}`)
  }

  dsh(['plugin', '--profile', 'web', 'add', bundle])
  const installed = dsh(['--profile', 'web', '--dump-config'])
  const expectedRows = [
    ['learn-dsh-curriculum', '@learn-dsh/curriculum'],
    ['learn-dsh-learner-memory', '@learn-dsh/learner-memory/local'],
    ['learn-dsh-learner', '@learn-dsh/learner'],
    ['learn-dsh-lab', '@learn-dsh/lab/local'],
    ['learn-dsh-teaching', '@learn-dsh/teaching'],
  ]
  for (const [id, name] of expectedRows) {
    if (!installed.includes(`id: ${id}`) || !installed.includes(`name: '${name}'`)) {
      throw new Error(`Installed profile did not contain ${name}.\n${installed}`)
    }
  }
  const help = dsh(['--profile', 'web', '--help'])
  if (!help.includes('Serve the DeepSeek Harness browser UI.')) {
    throw new Error(`Installed web profile did not reach its app-owned CLI surface.\n${help}`)
  }

  dsh(['plugin', '--profile', 'web', 'remove', '@learn-dsh/bundle'])
  const removed = dsh(['--profile', 'web', '--dump-config'])
  for (const [id, name] of expectedRows) {
    if (removed.includes(id) || removed.includes(name)) {
      throw new Error(`Removed profile retained ${name}.\n${removed}`)
    }
  }
  if (removed !== webBefore) {
    throw new Error('Installing and removing Learn DSH changed the underlying web profile composition.')
  }

  dsh(['plugin', '--profile', 'web', 'add', bundle])
  const reinstalled = dsh(['--profile', 'web', '--dump-config'])
  for (const [id, name] of expectedRows) {
    if (!reinstalled.includes(`id: ${id}`) || !reinstalled.includes(`name: '${name}'`)) {
      throw new Error(`Reinstalled profile did not contain ${name}.\n${reinstalled}`)
    }
  }
  dsh(['--profile', 'web', '--help'])
  dsh(['plugin', '--profile', 'web', 'remove', '@learn-dsh/bundle'])
  const removedAgain = dsh(['--profile', 'web', '--dump-config'])
  for (const [id, name] of expectedRows) {
    if (removedAgain.includes(id) || removedAgain.includes(name)) {
      throw new Error(`Second removal retained ${name}.\n${removedAgain}`)
    }
  }
  if (removedAgain !== webBefore) {
    throw new Error('Reinstalling and removing Learn DSH changed the underlying web profile composition.')
  }
  setup(['remove'])
  try {
    await access(presetDirectory)
    throw new Error(`Preset removal retained ${presetDirectory}.`)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Preset removal retained')) throw error
    if (error?.code !== 'ENOENT') throw error
  }
  const headlessAfter = dsh(['--profile', 'headless', '--dump-config'])
  if (headlessAfter !== headlessBefore) {
    throw new Error('Installing and removing Learn DSH changed the independent headless profile.')
  }
  process.stdout.write('Preset install/check/remove, web-profile install/start/remove/reinstall, and independent headless-profile stability passed.\n')
} finally {
  await rm(home, { recursive: true, force: true })
}
