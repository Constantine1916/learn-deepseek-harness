import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
const compatibility = JSON.parse(await readFile(resolve(root, 'compatibility.json'), 'utf8'))
const supportedDsh = compatibility.supportedDsh
const sourceCheckout = resolve(root, process.env.DSH_CHECKOUT ?? supportedDsh.developmentCheckout.relativePath)
const headlessManifest = JSON.parse(await readFile(resolve(root, 'examples/headless/package.json'), 'utf8'))
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
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
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

function verifyDshTree(dependencies) {
  for (const [name, dependency] of Object.entries(dependencies ?? {})) {
    if (name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) {
      if (dependency.version !== supportedDsh.version) {
        throw new Error(`Consumer resolved mixed DSH dependency ${name}@${String(dependency.version)}.`)
      }
      if (/^(?:file|link):/.test(dependency.resolved ?? '') || dependency.path?.startsWith(sourceCheckout)) {
        throw new Error(`Consumer resolved ${name} outside the npm registry installation.`)
      }
    }
    verifyDshTree(dependency.dependencies)
    verifyDshTree(dependency.optionalDependencies)
  }
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
    ...Object.entries(headlessManifest.dependencies)
      .filter(([name]) => name.startsWith('@deepseek-ai/')),
    ...[...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]),
  ])
  const overrides = Object.fromEntries(
    [...tarballs]
      .filter(([name]) => name !== '@learn-dsh/bundle')
      .map(([name, tarball]) => [name, `file:${tarball}`]),
  )
  await mkdir(consumerRoot)
  await writeFile(resolve(consumerRoot, 'package.json'), `${JSON.stringify({
    name: 'learn-dsh-release-candidate-consumer',
    private: true,
    type: 'module',
    dependencies,
  }, null, 2)}\n`)
  await writeFile(resolve(consumerRoot, 'pnpm-workspace.yaml'), [
    "packages: ['.']",
    'overrides:',
    ...Object.entries(overrides).map(([name, target]) => `  ${JSON.stringify(name)}: ${JSON.stringify(target)}`),
    'allowBuilds:',
    "  '@deepseek-ai/dsh-subprocess-local': true",
    "  '@google/genai': false",
    '  esbuild: true',
    '  koffi: true',
    '  node-pty: true',
    '  protobufjs: false',
    '',
  ].join('\n'))
  run('pnpm', ['install', '--no-frozen-lockfile'], { cwd: consumerRoot })

  const consumerLock = await readFile(resolve(consumerRoot, 'pnpm-lock.yaml'), 'utf8')
  if (/(?:^|\s)(?:link|workspace):/m.test(consumerLock)) {
    throw new Error('Consumer lockfile contains a link: or workspace: dependency.')
  }
  if (consumerLock.includes(sourceCheckout)) {
    throw new Error('Consumer lockfile contains the DSH source-checkout path.')
  }
  const installedDsh = JSON.parse(await readFile(resolve(consumerRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
  if (installedDsh.version !== supportedDsh.version) {
    throw new Error(`Consumer installed @deepseek-ai/dsh@${String(installedDsh.version)} instead of ${supportedDsh.version}.`)
  }
  const dependencyTree = JSON.parse(run('pnpm', ['list', '--json', '--depth', 'Infinity'], { cwd: consumerRoot }))
  for (const project of dependencyTree) verifyDshTree(project.dependencies)

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
    env: {
      ...process.env,
      DSH_CLI_ROOT: consumerRoot,
      LEARN_DSH_BUNDLE_PATH: installedBundle,
    },
  })

  const exampleRoot = resolve(consumerRoot, 'keyless-example')
  const exampleLib = resolve(exampleRoot, 'lib')
  await mkdir(exampleLib, { recursive: true })
  await copyFile(resolve(root, 'examples/headless/lib/bin.js'), resolve(exampleLib, 'bin.js'))
  await copyFile(resolve(root, 'examples/headless/lib/profile.js'), resolve(exampleLib, 'profile.js'))
  await copyFile(resolve(root, 'examples/headless/headless.patch.yml'), resolve(exampleRoot, 'headless.patch.yml'))
  const keylessOutput = run(process.execPath, [resolve(exampleLib, 'bin.js')], {
    cwd: consumerRoot,
    env: {
      ...process.env,
      DSH_CHECKOUT: sourceCheckout,
      DSH_HOME: resolve(temporaryRoot, 'keyless-home'),
    },
  })
  const expectedKeylessOutput = await readFile(resolve(root, 'examples/headless/tests/snapshots/headless.expected.json'), 'utf8')
  if (keylessOutput !== expectedKeylessOutput) {
    throw new Error('Registry-only keyless teaching output differs from the reviewed snapshot.')
  }

  if (rootManifest.version !== '0.1.0') throw new Error('Release candidate expects root version 0.1.0.')
  process.stdout.write(
    `Release candidate passed for ${tarballs.size} public tarballs, registry DSH ${supportedDsh.version}, clean imports, profile reinstall, and keyless teaching.\n`,
  )
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
