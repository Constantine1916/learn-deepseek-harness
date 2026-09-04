import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const textExtensions = new Set([
  '', '.cjs', '.css', '.d.ts', '.html', '.js', '.json', '.jsonl', '.md', '.mjs', '.ts', '.tsx', '.txt', '.yaml', '.yml',
])
const secretPatterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['OpenAI or DeepSeek style key', /\bsk-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\b(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['AWS access key', /\bAKIA[A-Z0-9]{16}\b/],
]

const candidates = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })
  .toString('utf8')
  .split('\0')
  .filter(Boolean)

const failures = []
for (const relative of candidates) {
  if (!textExtensions.has(extname(relative))) continue
  if (/(?:^|\/)\.env(?:\.|$)/.test(relative)) {
    failures.push(`${relative}: tracked environment file`)
    continue
  }
  let content
  try {
    content = await readFile(resolve(root, relative), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') continue
    throw error
  }
  for (const [label, pattern] of secretPatterns) {
    if (pattern.test(content)) failures.push(`${relative}: ${label}`)
  }
}

if (failures.length > 0) {
  throw new Error(`Potential credentials found in tracked files:\n${failures.join('\n')}`)
}

process.stdout.write(`Secret scan passed across ${candidates.length} tracked or untracked candidate files.\n`)
