import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./provider.ts', import.meta.url), 'utf8')
const requirements = [
  ['Context augmentation', /declare\s+module\s+['"]@deepseek-ai\/cordis['"][\s\S]*clock\s*:\s*Clock/],
  ['Clock Service Definition', /export\s+abstract\s+class\s+Clock\s+extends\s+Service/],
  ['Definition method', /abstract\s+now\s*\(\s*\)\s*:\s*number/],
  ['Local Provider', /export\s+class\s+LocalClock\s+extends\s+Clock/],
  ['Service registration', /super\s*\(\s*ctx\s*,\s*['"]clock['"]\s*\)/],
  ['Provider implementation', /(?:override\s+)?now\s*\(\s*\)\s*:\s*number\s*\{/],
  ['Definition-only Consumer', /export\s+function\s+readClock\s*\(\s*ctx\s*:\s*Context\s*\)[\s\S]*ctx\.clock\.now\s*\(/],
]
const missing = requirements.filter(([, pattern]) => !pattern.test(source)).map(([label]) => label)
const payload = missing.length === 0
  ? { summary: 'The Clock capability seam satisfies the deterministic contract', details: requirements.map(([label]) => `${label} present`), artifacts: ['provider.ts'] }
  : { summary: 'The Clock capability seam is incomplete', details: missing.map(label => `missing: ${label}`), artifacts: ['provider.ts'] }
process.stdout.write(`${JSON.stringify(payload)}\n`)
process.exitCode = missing.length === 0 ? 0 : 1
