import { writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  healProfilesModuleFallback,
  loadOverlayPatches,
  loadProfile,
  type ProfileLayer,
} from '@deepseek-ai/dsh-app-boot'

const installAnchor = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')

function insertedPluginNames(entries: readonly EntryOptions[]): string[] {
  return entries.flatMap((entry) => {
    const children = entry.group && Array.isArray(entry.config)
      ? insertedPluginNames(entry.config as EntryOptions[])
      : []
    return [entry.name, ...children]
  })
}

function packageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('file:') || specifier.includes(':')) return undefined
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

function overlayModuleLayers(path: string, patches: readonly PatchOptions[]): ProfileLayer[] {
  const require = createRequire(path)
  const packages = new Map<string, string>()
  const inserted = patches.flatMap(patch => patch.insert ?? [])
  for (const specifier of insertedPluginNames(inserted)) {
    const name = packageName(specifier)
    if (name === undefined || packages.has(name)) continue
    packages.set(name, dirname(require.resolve(`${name}/package.json`)))
  }
  return [...packages].map(([name, packageDir], index) => ({
    packageName: `learn-dsh-overlay:${String(index)}:${name}`,
    packageDir,
    patchPath: path,
    patches: [],
  }))
}

/** Boot the published DSH headless profile with Learn DSH's keyless overlay. */
export async function bootHeadlessProfile(binName: string, overlayPath: string): Promise<Context> {
  const profile = loadProfile(binName, 'headless', installAnchor, undefined, { userLayer: false })
  const rootConfig = join(profile.dir, 'cordis.yml')
  await writeFile(rootConfig, '[]\n')
  const patches = loadOverlayPatches(binName, overlayPath)
  const moduleLayers = overlayModuleLayers(overlayPath, patches)
  await healProfilesModuleFallback({
    installAnchor,
    profile: { ...profile, layers: [...profile.layers, ...moduleLayers] },
  })
  return boot(
    binName,
    rootConfig,
    [...profile.layers.flatMap(layer => layer.patches), ...patches],
  )
}
