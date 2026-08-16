import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('./tool.ts', import.meta.url), 'utf8')
const requirements = [
  ['Pure greeting function', /export\s+function\s+greet\s*\(\s*name\s*:\s*string\s*\)\s*:\s*string/],
  ['Tool definition', /defineTool\s*\(\s*\{/],
  ['Stable tool name', /name\s*:\s*['"]greet['"]/],
  ['Required string parameter', /parameters\s*:\s*\{[\s\S]*name\s*:\s*\{[\s\S]*type\s*:\s*['"]string['"][\s\S]*required\s*:\s*true/],
  ['Structured output schema', /output\s*:\s*\{[\s\S]*greeting\s*:\s*\{[\s\S]*type\s*:\s*['"]string['"][\s\S]*required\s*:\s*true/],
  ['Pure function execution', /execute\s*\([^)]*\)\s*\{[\s\S]*greet\s*\(/],
  ['Native renderer', /render\s*:\s*\(/],
  ['Cordis registration', /export\s+function\s+apply\s*\(\s*ctx\s*:\s*Context\s*\)[\s\S]*ctx\.tools\.register/],
]
const missing = requirements.filter(([, pattern]) => !pattern.test(source)).map(([label]) => label)
const payload = missing.length === 0
  ? { summary: 'The greet Tool satisfies the deterministic contract', details: requirements.map(([label]) => `${label} present`), artifacts: ['tool.ts'] }
  : { summary: 'The greet Tool is incomplete', details: missing.map(label => `missing: ${label}`), artifacts: ['tool.ts'] }
process.stdout.write(`${JSON.stringify(payload)}\n`)
process.exitCode = missing.length === 0 ? 0 : 1
