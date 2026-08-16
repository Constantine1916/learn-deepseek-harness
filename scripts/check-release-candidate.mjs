import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(root, process.env.DSH_CHECKOUT ?? '../deepseek-harness')
const rootManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const packageDirectories = [
  'curriculum',
  'learner-memory',
  'learner',
  'lab',
  'teaching',
  'teacher',
  'tool-learning',
  'bundle',
]
const forbiddenRuntimeProtocols = /^(?:workspace|link):/
const forbiddenArchivePaths = [
  /(?:^|\/)src\//,
  /(?:^|\/)tests?\//,
  /(?:^|\/)coverage\//,
  /(?:^|\/)\.env(?:\.|$)/,
  /(?:^|\/).*\.tsbuildinfo$/,
  /(?:^|\/)learner-memory\//,
  /(?:^|\/)sessions?\//,
  /(?:^|\/)attempts?\//,
]
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
]
const localPeers = {
  '@deepseek-ai/cordis': resolve(checkout, 'vendor/cordis'),
  '@deepseek-ai/dsh-agent': resolve(checkout, 'packages/core/agent'),
  '@deepseek-ai/dsh-fs': resolve(checkout, 'packages/fs/fs'),
  '@deepseek-ai/dsh-sandbox-policy': resolve(checkout, 'packages/sandbox/sandbox-policy'),
  '@deepseek-ai/dsh-session': resolve(checkout, 'packages/core/session'),
  '@deepseek-ai/dsh-shell': resolve(checkout, 'packages/shell/shell'),
  '@deepseek-ai/dsh-system-prompt': resolve(checkout, 'packages/core/system-prompt'),
  '@deepseek-ai/dsh-tools': resolve(checkout, 'packages/core/tools'),
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${String(result.status)}).\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`)
  }
  return result.stdout
}

function runtimeDependencyEntries(manifest) {
  return Object.entries({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  })
}

function archiveEntries(tarball) {
  return execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
}

function archiveText(tarball, path) {
  return execFileSync('tar', ['-xOzf', tarball, path], { encoding: 'utf8' })
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'learn-dsh-release-candidate-'))
try {
  const tarballs = new Map()
  for (const directory of packageDirectories) {
    const packageRoot = resolve(root, 'packages', directory)
    const packed = JSON.parse(run('pnpm', ['pack', '--pack-destination', temporaryRoot, '--json'], { cwd: packageRoot }))
    const tarball = resolve(packed.filename)
    const entries = archiveEntries(tarball)
    const manifest = JSON.parse(archiveText(tarball, 'package/package.json'))

    if (manifest.name !== `@learn-dsh/${directory}`) throw new Error(`Unexpected package name ${String(manifest.name)} for ${directory}.`)
    if (manifest.version !== rootManifest.version) throw new Error(`${manifest.name} version does not match root version ${rootManifest.version}.`)
    if (manifest.license !== rootManifest.license) throw new Error(`${manifest.name} license does not match the root manifest.`)
    if (manifest.engines?.node !== rootManifest.engines.node) throw new Error(`${manifest.name} Node range does not match the root manifest.`)
    if (manifest.publishConfig?.access !== 'public') throw new Error(`${manifest.name} must publish as a public scoped package.`)
    if (manifest.repository?.directory !== `packages/${directory}`) throw new Error(`${manifest.name} repository directory is missing or incorrect.`)

    for (const [name, version] of runtimeDependencyEntries(manifest)) {
      if (forbiddenRuntimeProtocols.test(String(version))) {
        throw new Error(`${manifest.name} keeps non-publishable runtime dependency ${name}@${String(version)} in its tarball.`)
      }
    }
    for (const entry of entries) {
      if (forbiddenArchivePaths.some(pattern => pattern.test(entry))) {
        throw new Error(`${manifest.name} tarball contains forbidden release path ${entry}.`)
      }
      if (!/\.(?:d\.ts|js|json|md|mjs|ts|txt|ya?ml)$/.test(entry)) continue
      const content = archiveText(tarball, entry)
      if (secretPatterns.some(pattern => pattern.test(content))) {
        throw new Error(`${manifest.name} tarball contains a potential credential in ${entry}.`)
      }
    }

    const exportTargets = Object.values(manifest.exports ?? {}).flatMap(value => {
      if (typeof value === 'string') return [value]
      return Object.values(value)
    })
    const normalizedEntries = new Set(entries.map(entry => entry.replace(/^package\//, './')))
    for (const target of exportTargets) {
      if (typeof target === 'string' && !normalizedEntries.has(target)) {
        throw new Error(`${manifest.name} export target ${target} is missing from its tarball.`)
      }
    }
    for (const target of Object.values(manifest.bin ?? {})) {
      const normalized = String(target).startsWith('./') ? String(target) : `./${String(target)}`
      if (!normalizedEntries.has(normalized)) throw new Error(`${manifest.name} bin target ${normalized} is missing from its tarball.`)
    }

    tarballs.set(manifest.name, tarball)
  }

  const consumerRoot = resolve(temporaryRoot, 'consumer')
  const dependencies = Object.fromEntries([
    ...[...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]),
    ...Object.entries(localPeers).map(([name, path]) => [name, `link:${path}`]),
  ])
  const overrides = Object.fromEntries(
    [...tarballs]
      .filter(([name]) => name !== '@learn-dsh/bundle')
      .map(([name, tarball]) => [name, `file:${tarball}`]),
  )
  await writeFile(resolve(temporaryRoot, 'consumer-package.json'), `${JSON.stringify({
    name: 'learn-dsh-release-candidate-consumer',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2)}\n`)
  await mkdir(consumerRoot)
  await copyFile(resolve(temporaryRoot, 'consumer-package.json'), resolve(consumerRoot, 'package.json'))
  await writeFile(resolve(consumerRoot, 'pnpm-workspace.yaml'), [
    "packages: ['.']",
    'overrides:',
    ...Object.entries(overrides).map(([name, target]) => `  ${JSON.stringify(name)}: ${JSON.stringify(target)}`),
    '',
  ].join('\n'))
  run('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], { cwd: consumerRoot })

  for (const name of tarballs.keys()) {
    run('node', ['--input-type=module', '--eval', `await import(${JSON.stringify(name)})`], { cwd: consumerRoot })
  }
  run('node', ['--input-type=module', '--eval', "await import('@learn-dsh/bundle/setup')"], { cwd: consumerRoot })

  const setupHome = resolve(temporaryRoot, 'setup-home')
  const setupPath = run('pnpm', ['exec', 'learn-dsh-setup', 'path', '--home', setupHome], { cwd: consumerRoot }).trim()
  if (setupPath !== resolve(setupHome, '.agent-presets/learn-dsh')) {
    throw new Error(`Packed setup CLI resolved an unexpected preset path: ${setupPath}`)
  }

  const installedBundle = resolve(consumerRoot, 'node_modules/@learn-dsh/bundle')
  run('node', ['scripts/check-profile-install.mjs'], {
    cwd: root,
    env: { ...process.env, LEARN_DSH_BUNDLE_PATH: installedBundle },
  })

  if (rootManifest.version !== '0.1.0') throw new Error('Release candidate expects root version 0.1.0.')
  process.stdout.write(`Release candidate passed for ${tarballs.size} public tarballs, clean consumer import, and profile reinstall.\n`)
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
