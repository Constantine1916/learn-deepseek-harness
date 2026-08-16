import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'

const input = JSON.parse(await new Promise((resolveInput, reject) => {
  let text = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { text += chunk })
  process.stdin.on('end', () => resolveInput(text))
  process.stdin.on('error', reject)
}))

const { operation, root, target, fixture, marker } = input
const markerName = '.learn-dsh-attempt.json'

function inside(parent, child) {
  const offset = relative(parent, child)
  return offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`)
}

if (operation !== 'create' && operation !== 'reset') throw new Error('unsupported attempt operation')
if (![root, target, fixture].every(value => typeof value === 'string' && value.length > 0)) throw new Error('attempt paths must be non-empty strings')
if (marker === null || typeof marker !== 'object' || Array.isArray(marker)) throw new Error('attempt marker must be an object')

await mkdir(root, { recursive: true })
const realRoot = await realpath(root)
const resolvedTarget = resolve(target)
if (!inside(realRoot, resolvedTarget) || dirname(resolvedTarget) !== realRoot) throw new Error('attempt target must be a direct child of the workspace root')

const fixtureInfo = await lstat(fixture)
if (!fixtureInfo.isDirectory() || fixtureInfo.isSymbolicLink()) throw new Error('attempt fixture must be a real directory')

const markerPath = resolve(resolvedTarget, markerName)
const expectedMarker = `${JSON.stringify(marker, undefined, 2)}\n`
let targetExists = true
try {
  await lstat(resolvedTarget)
} catch (error) {
  if (error?.code === 'ENOENT') targetExists = false
  else throw error
}

if (targetExists) {
  const targetInfo = await lstat(resolvedTarget)
  if (!targetInfo.isDirectory() || targetInfo.isSymbolicLink()) throw new Error('existing attempt must be a real directory')
  let actualMarker
  try {
    actualMarker = await readFile(markerPath, 'utf8')
  } catch (error) {
    throw new Error(`existing attempt is missing its identity marker: ${String(error)}`)
  }
  if (actualMarker !== expectedMarker) throw new Error('existing attempt identity marker does not match')
  if (operation === 'create') {
    process.stdout.write(JSON.stringify({ reused: true }))
    process.exit(0)
  }
  await rm(resolvedTarget, { recursive: true })
}

await cp(fixture, resolvedTarget, { recursive: true, force: false, errorOnExist: true })
await writeFile(markerPath, expectedMarker, { encoding: 'utf8', flag: 'wx' })
process.stdout.write(JSON.stringify({ reused: false }))
