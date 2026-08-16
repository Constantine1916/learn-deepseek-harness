import { readFile } from 'node:fs/promises'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const [metadataText, patch, provider, tool] = await Promise.all([
  read('./package.json'),
  read('./cordis.patch.yml'),
  read('./provider.ts'),
  read('./tool.ts'),
])
let metadata
try { metadata = JSON.parse(metadataText) } catch { metadata = null }
const requirements = [
  ['Bundle metadata', metadata?.dsh?.bundle === './cordis.patch.yml'],
  ['Provider patch row', /id\s*:\s*clock-provider[\s\S]*name\s*:\s*['"]?\.\/provider\.ts['"]?/.test(patch)],
  ['Tool patch row', /id\s*:\s*greet-tool[\s\S]*name\s*:\s*['"]?\.\/tool\.ts['"]?/.test(patch)],
  ['Clock Provider source', /export\s+class\s+LocalClock\s+extends\s+Clock/.test(provider) && /super\s*\(\s*ctx\s*,\s*['"]clock['"]\s*\)/.test(provider)],
  ['Greet Tool source', /defineTool\s*\(\s*\{/.test(tool) && /name\s*:\s*['"]greet['"]/.test(tool) && /ctx\.tools\.register/.test(tool)],
]
const missing = requirements.filter(([, passed]) => !passed).map(([label]) => label)
const payload = missing.length === 0
  ? { summary: 'The Provider and Tool compose into a valid bundle fixture', details: requirements.map(([label]) => `${label} present`), artifacts: ['package.json', 'cordis.patch.yml', 'provider.ts', 'tool.ts'] }
  : { summary: 'The bundle composition is incomplete', details: missing.map(label => `missing: ${label}`), artifacts: ['package.json', 'cordis.patch.yml', 'provider.ts', 'tool.ts'] }
process.stdout.write(`${JSON.stringify(payload)}\n`)
process.exitCode = missing.length === 0 ? 0 : 1
