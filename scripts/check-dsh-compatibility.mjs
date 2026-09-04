import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfies } from 'semver'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const matrix = JSON.parse(await readFile(resolve(root, 'compatibility.json'), 'utf8'))
const supported = matrix.supportedDsh
const checkout = resolve(root, process.env.DSH_CHECKOUT ?? supported.developmentCheckout.relativePath)
const sourceManifest = JSON.parse(await readFile(resolve(checkout, 'package.json'), 'utf8'))
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
const requireFromExample = createRequire(resolve(root, 'examples/headless/package.json'))
const installedDshManifest = JSON.parse(await readFile(requireFromExample.resolve('@deepseek-ai/dsh/package.json'), 'utf8'))

if (sourceManifest.name !== '@deepseek-ai/dsh-root') {
  throw new Error(`Expected a DeepSeek Harness source checkout at ${checkout}, found ${JSON.stringify(sourceManifest.name)}.`)
}
if (sourceManifest.version !== supported.version) {
  throw new Error(`Learn DSH supports DSH ${supported.version}, but source checkout ${checkout} is ${sourceManifest.version}.`)
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim()
if (commit !== supported.developmentCheckout.commit) {
  throw new Error(`Learn DSH expects source-anchor commit ${supported.developmentCheckout.commit}, but ${checkout} is ${commit}.`)
}
if (installedDshManifest.version !== supported.version) {
  throw new Error(`Registry-installed @deepseek-ai/dsh is ${installedDshManifest.version}, expected ${supported.version}.`)
}

const manifestPaths = [
  ...packageDirectories.map(directory => resolve(root, 'packages', directory, 'package.json')),
  resolve(root, 'examples/headless/package.json'),
]
for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const runtimeEntries = Object.entries({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
    ...manifest.devDependencies,
  })
  for (const [name, version] of runtimeEntries) {
    if ((name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')) && version !== supported.version) {
      throw new Error(`${manifest.name} resolves ${name}@${String(version)} instead of exact ${supported.version}.`)
    }
  }
}
if (!satisfies(process.version, supported.nodeRange)) {
  throw new Error(`Node ${process.version} is outside the supported range ${supported.nodeRange}.`)
}

process.stdout.write(
  `Compatible: registry DSH ${installedDshManifest.version}; source anchors ${commit.slice(0, 12)} at ${checkout}; Node ${process.version}.\n`,
)
