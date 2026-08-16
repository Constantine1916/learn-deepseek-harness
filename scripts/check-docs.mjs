import { access, readdir, readFile } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const roots = ['README.md', 'CONTRIBUTING.md', 'SPEC.md', 'specs', 'docs', 'packages', 'examples']
const ignoredDirectories = new Set(['.git', 'coverage', 'dist', 'lib', 'node_modules'])

async function markdownFiles(path) {
  const absolute = resolve(root, path)
  try {
    const entries = await readdir(absolute, { withFileTypes: true })
    const nested = await Promise.all(entries
      .filter(entry => !entry.isDirectory() || !ignoredDirectories.has(entry.name))
      .map(entry => markdownFiles(resolve(path, entry.name))))
    return nested.flat()
  } catch (error) {
    if (error?.code === 'ENOTDIR') return extname(absolute) === '.md' ? [absolute] : []
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

const files = (await Promise.all(roots.map(markdownFiles))).flat()
const failures = []
for (const file of files) {
  const markdown = await readFile(file, 'utf8')
  for (const match of markdown.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, '')
    if (/^(?:[a-z]+:|#)/i.test(raw)) continue
    const target = decodeURIComponent(raw.split('#', 1)[0].split('?', 1)[0])
    if (target.length === 0) continue
    try {
      await access(resolve(dirname(file), target))
    } catch {
      failures.push(`${file.slice(root.length + 1)} -> ${raw}`)
    }
  }
}

if (failures.length > 0) {
  throw new Error(`Broken documentation links:\n${failures.join('\n')}`)
}
process.stdout.write(`Documentation links valid across ${files.length} Markdown files.\n`)
