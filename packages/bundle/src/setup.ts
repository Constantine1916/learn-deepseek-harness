import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const LEARN_DSH_PRESET_ID = 'learn-dsh'
export const PRESET_MARKER_FILE = '.learn-dsh-preset.json'

const presetFiles = ['agent.cordis.yml', 'preset.yml'] as const
const sourceDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../presets', LEARN_DSH_PRESET_ID)
const marker = `${JSON.stringify({
  schemaVersion: 1,
  owner: '@learn-dsh/bundle',
  presetId: LEARN_DSH_PRESET_ID,
}, null, 2)}\n`

export type PresetSetupStatus = 'installed' | 'unchanged' | 'removed' | 'missing'

export interface PresetSetupResult {
  readonly home: string
  readonly presetDirectory: string
  readonly status: PresetSetupStatus
}

export interface InstallPresetOptions {
  readonly home?: string
  readonly force?: boolean
}

function resolveHome(input?: string): string {
  const value = input ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  if (value.trim() === '') throw new Error('DSH home must be a non-empty path.')
  const home = resolve(value)
  if (home === parse(home).root) throw new Error('DSH home cannot be a filesystem root.')
  return home
}

function paths(input?: string): { home: string, directory: string } {
  const home = resolveHome(input)
  return { home, directory: join(home, '.agent-presets', LEARN_DSH_PRESET_ID) }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

async function validatePresetRoot(home: string, create: boolean): Promise<boolean> {
  const root = join(home, '.agent-presets')
  if (!await exists(root)) {
    if (!create) return false
    await mkdir(root, { recursive: true })
  }
  const stats = await lstat(root)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`DSH agent-preset root is not a real directory: ${root}`)
  }
  return true
}

async function requireManagedDirectory(directory: string): Promise<void> {
  const stats = await lstat(directory)
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Learn DSH preset target is not a real directory: ${directory}`)
  }
  const actualMarker = await readFile(join(directory, PRESET_MARKER_FILE), 'utf8').catch(() => '')
  if (actualMarker !== marker) {
    throw new Error(`Refusing to modify preset directory not owned by @learn-dsh/bundle: ${directory}`)
  }
}

async function sourceContents(): Promise<Map<string, string>> {
  return new Map(await Promise.all(presetFiles.map(async file => [file, await readFile(join(sourceDirectory, file), 'utf8')] as const)))
}

async function isCurrent(directory: string, contents: ReadonlyMap<string, string>): Promise<boolean> {
  try {
    await requireManagedDirectory(directory)
    for (const [file, expected] of contents) {
      if (await readFile(join(directory, file), 'utf8') !== expected) return false
    }
    return true
  } catch {
    return false
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, content, { flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export function presetDirectory(home?: string): string {
  return paths(home).directory
}

export async function checkPreset(home?: string): Promise<PresetSetupResult> {
  const resolved = paths(home)
  const contents = await sourceContents()
  if (!await validatePresetRoot(resolved.home, false) || !await exists(resolved.directory)) {
    return { home: resolved.home, presetDirectory: resolved.directory, status: 'missing' }
  }
  await requireManagedDirectory(resolved.directory)
  if (!await isCurrent(resolved.directory, contents)) {
    throw new Error(`Installed Learn DSH preset differs from the packaged release: ${resolved.directory}`)
  }
  return { home: resolved.home, presetDirectory: resolved.directory, status: 'unchanged' }
}

export async function installPreset(options: InstallPresetOptions = {}): Promise<PresetSetupResult> {
  const resolved = paths(options.home)
  const contents = await sourceContents()
  await validatePresetRoot(resolved.home, true)
  if (await exists(resolved.directory)) {
    await requireManagedDirectory(resolved.directory)
    if (await isCurrent(resolved.directory, contents)) {
      return { home: resolved.home, presetDirectory: resolved.directory, status: 'unchanged' }
    }
    if (options.force !== true) {
      throw new Error(`Installed Learn DSH preset differs from this release; rerun with --force to replace managed files: ${resolved.directory}`)
    }
  } else {
    await mkdir(resolved.directory, { recursive: true })
  }
  for (const [file, content] of contents) await atomicWrite(join(resolved.directory, file), content)
  await atomicWrite(join(resolved.directory, PRESET_MARKER_FILE), marker)
  return { home: resolved.home, presetDirectory: resolved.directory, status: 'installed' }
}

export async function removePreset(home?: string): Promise<PresetSetupResult> {
  const resolved = paths(home)
  if (!await validatePresetRoot(resolved.home, false) || !await exists(resolved.directory)) {
    return { home: resolved.home, presetDirectory: resolved.directory, status: 'missing' }
  }
  await requireManagedDirectory(resolved.directory)
  const entries = await readdir(resolved.directory)
  const expected = new Set([...presetFiles, PRESET_MARKER_FILE])
  const unexpected = entries.filter(entry => !expected.has(entry))
  if (unexpected.length > 0) {
    throw new Error(`Refusing to remove Learn DSH preset directory with unowned files: ${unexpected.join(', ')}`)
  }
  await rm(resolved.directory, { recursive: true })
  return { home: resolved.home, presetDirectory: resolved.directory, status: 'removed' }
}
