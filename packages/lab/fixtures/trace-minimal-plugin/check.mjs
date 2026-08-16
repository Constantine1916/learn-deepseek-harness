import { readFile } from 'node:fs/promises'

const artifact = 'answer.json'
const requiredText = ['plugin', 'context', 'service', 'effect', 'typedEvent', 'disposalEvidence']
const allowedSources = new Set([
  'docs/architecture.md',
  'vendor/cordis/src/context.ts',
  'vendor/cordis/src/service.ts',
])

let answer
try {
  answer = JSON.parse(await readFile(artifact, 'utf8'))
} catch (error) {
  process.stdout.write(JSON.stringify({
    summary: 'answer.json is not valid JSON',
    details: [String(error)],
    artifacts: [artifact],
  }))
  process.exit(1)
}

const failures = []
for (const field of requiredText) {
  if (typeof answer[field] !== 'string' || answer[field].trim().length < 12) failures.push(`${field} must contain a substantive explanation`)
}
if (!Array.isArray(answer.sourceRefs)) failures.push('sourceRefs must be an array')
else {
  const unique = new Set(answer.sourceRefs)
  if (unique.size < 2) failures.push('sourceRefs must cite at least two distinct curriculum sources')
  for (const source of unique) if (!allowedSources.has(source)) failures.push(`unsupported sourceRef: ${String(source)}`)
}

process.stdout.write(JSON.stringify({
  summary: failures.length === 0 ? 'The lifecycle trace artifact passed deterministic checks' : 'The lifecycle trace artifact is incomplete',
  details: failures.length === 0 ? ['answer.json has every required field and at least two valid source citations'] : failures,
  artifacts: [artifact],
}))
process.exit(failures.length === 0 ? 0 : 1)
