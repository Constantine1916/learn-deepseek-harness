import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { satisfies } from 'semver'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const matrix = JSON.parse(await readFile(resolve(root, 'compatibility.json'), 'utf8'))
const supported = matrix.supportedDsh
const checkout = resolve(root, process.env.DSH_CHECKOUT ?? supported.developmentCheckout.relativePath)
const manifest = JSON.parse(await readFile(resolve(checkout, 'package.json'), 'utf8'))
const teacherManifest = JSON.parse(await readFile(resolve(root, 'packages/teacher/package.json'), 'utf8'))

if (manifest.name !== '@deepseek-ai/dsh-root') {
  throw new Error(`Expected a DeepSeek Harness checkout at ${checkout}, found ${JSON.stringify(manifest.name)}.`)
}
if (manifest.version !== supported.version) {
  throw new Error(`Learn DSH supports DSH ${supported.version}, but ${checkout} is ${manifest.version}.`)
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim()
if (commit !== supported.developmentCheckout.commit) {
  throw new Error(`Learn DSH Phase 0 expects DSH commit ${supported.developmentCheckout.commit}, but ${checkout} is ${commit}.`)
}
if (teacherManifest.peerDependencies['@deepseek-ai/dsh-system-prompt'] !== supported.version) {
  throw new Error('The teacher peer dependency does not match compatibility.json.')
}
if (!satisfies(process.version, supported.nodeRange)) {
  throw new Error(`Node ${process.version} is outside the supported range ${supported.nodeRange}.`)
}

process.stdout.write(`Compatible: DSH ${manifest.version} (${commit.slice(0, 12)}) at ${checkout}; Node ${process.version}.\n`)
