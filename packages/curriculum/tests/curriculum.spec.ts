import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { load } from 'js-yaml'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import CurriculumService, {
  CurriculumValidationError,
  CourseId,
  UnitId,
  loadCourseFile,
  parseCourseManifest,
  verifyCourseSources,
  type CourseManifest,
} from '@learn-dsh/curriculum'

interface RawSource {
  repository: 'deepseek-harness'
  version: string
  path: string
  anchor: { kind: 'heading' | 'text' | 'export' | 'test', value: string }
  purpose: string
}

interface RawUnit {
  id: string
  outcomeIds: string[]
  objectives: string[]
  prerequisites: string[]
  dshVersionRange: string
  contentEntry: string
  sources: RawSource[]
  checkpoints: Array<{ id: string }>
  exercises: Array<{
    id: string
    fixture: string
    checks: Array<{ id: string, entry: string, timeoutMs: number }>
  }>
  hints: Array<{ level: number }>
  rubric: Array<{ id: string, evidenceKinds: string[] }>
  completion: {
    requiredCheckpointIds: string[]
    requiredExerciseIds: string[]
    requiredRubricIds: string[]
  }
}

interface RawFixture {
  version: string
  dshVersionRange: string
  learningOutcomes: Array<{ id: string }>
  units: RawUnit[]
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = resolve(packageRoot, 'curriculum/foundations/course.yml')
const dshRoot = resolve(packageRoot, '../../../deepseek-harness')

function fixture(): RawFixture {
  return load(readFileSync(manifestPath, 'utf8')) as RawFixture
}

function validCourse(): CourseManifest {
  return parseCourseManifest(fixture())
}

describe('F-003 versioned curriculum schema and graph', () => {
  it('loads the packaged foundations unit as immutable data for DSH rc.5', () => {
    const course = loadCourseFile(manifestPath, '0.1.0-rc.5')

    expect(course).toMatchObject({
      id: 'dsh-foundations',
      version: '0.1.0',
      dshVersionRange: '0.1.0-rc.5',
    })
    expect(course.units.map(unit => unit.id)).toEqual(['plugin-context-service-effect'])
    expect(course.units[0]?.hints.map(hint => hint.level)).toEqual([1, 2, 3])
    expect(Object.isFrozen(course)).toBe(true)
    expect(Object.isFrozen(course.units[0])).toBe(true)
  })

  it('rejects schema errors, invalid versions, duplicate ids, and unsafe paths', () => {
    const invalidSchema = fixture() as RawFixture & { title?: string }
    delete invalidSchema.title
    expect(() => parseCourseManifest(invalidSchema)).toThrow(/does not match schema/)

    const invalidVersion = fixture()
    invalidVersion.dshVersionRange = 'not a range'
    expect(() => parseCourseManifest(invalidVersion)).toThrow(/unsupported SemVer range/)

    const duplicateUnit = fixture()
    duplicateUnit.units.push(structuredClone(duplicateUnit.units[0]!))
    expect(() => parseCourseManifest(duplicateUnit)).toThrow(/units contains duplicate id/)

    const unsafeContent = fixture()
    unsafeContent.units[0]!.contentEntry = '../../outside.md'
    expect(() => parseCourseManifest(unsafeContent)).toThrow(/contentEntry must stay inside/)

    const unsafeSource = fixture()
    unsafeSource.units[0]!.sources[0]!.path = '/etc/passwd'
    expect(() => parseCourseManifest(unsafeSource)).toThrow(/source path must stay inside/)

    const unsafeFixture = fixture()
    unsafeFixture.units[0]!.exercises[0]!.fixture = '../outside'
    expect(() => parseCourseManifest(unsafeFixture)).toThrow(/fixture must stay inside/)

    const unsafeCheck = fixture()
    unsafeCheck.units[0]!.exercises[0]!.checks[0]!.entry = '/tmp/check.mjs'
    expect(() => parseCourseManifest(unsafeCheck)).toThrow(/check .* entry must stay inside/)

    const shortCommit = fixture()
    shortCommit.units[0]!.sources[0]!.version = '0cf6f64'
    expect(() => parseCourseManifest(shortCommit)).toThrow(/full git commit/)
  })

  it('rejects missing prerequisites, cycles, and dangling completion references', () => {
    const missing = fixture()
    missing.units[0]!.prerequisites = ['missing-unit']
    expect(() => parseCourseManifest(missing)).toThrow(/prerequisites references missing id/)

    const cyclic = fixture()
    const first = cyclic.units[0]!
    const second = structuredClone(first)
    second.id = 'second-unit'
    first.prerequisites = [second.id]
    second.prerequisites = [first.id]
    cyclic.units.push(second)
    expect(() => parseCourseManifest(cyclic)).toThrow(/graph contains a cycle/)

    const dangling = fixture()
    dangling.units[0]!.completion.requiredExerciseIds = ['missing-exercise']
    expect(() => parseCourseManifest(dangling)).toThrow(/completion\.requiredExerciseIds references missing id/)
  })

  it('rejects unsupported selected DSH versions and malformed hint levels', () => {
    expect(() => loadCourseFile(manifestPath, '0.1.0-rc.6')).toThrow(/does not support DSH/)
    expect(() => loadCourseFile(manifestPath, 'latest')).toThrow(/not exact SemVer/)

    const hints = fixture()
    hints.units[0]!.hints[1]!.level = 1
    expect(() => parseCourseManifest(hints)).toThrow(/levels 1, 2, and 3 in order/)
  })
})

describe('F-012 source anchor resolution', () => {
  it('resolves every packaged source anchor against the locked upstream checkout', () => {
    const verified = verifyCourseSources(validCourse(), dshRoot)
    expect(verified).toEqual([
      expect.objectContaining({ path: 'docs/architecture.md', anchorKind: 'heading', anchor: 'Cordis' }),
      expect.objectContaining({ path: 'vendor/cordis/src/context.ts', anchorKind: 'export', anchor: 'Context' }),
      expect.objectContaining({ path: 'vendor/cordis/src/service.ts', anchorKind: 'export', anchor: 'Service' }),
    ])
    expect(Object.isFrozen(verified)).toBe(true)
  })

  it('supports heading, export, test, and exact-text anchors', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'learn-dsh-anchors-'))
    try {
      await writeFile(resolve(root, 'sample.ts'), '# Runtime\nexport class Demo {}\ndescribe("lifecycle", () => {})\nexact marker\n')
      const raw = fixture()
      const base = raw.units[0]!.sources[0]!
      raw.units[0]!.sources = [
        { ...base, path: 'sample.ts', anchor: { kind: 'heading', value: 'Runtime' } },
        { ...base, path: 'sample.ts', anchor: { kind: 'export', value: 'Demo' } },
        { ...base, path: 'sample.ts', anchor: { kind: 'test', value: 'lifecycle' } },
        { ...base, path: 'sample.ts', anchor: { kind: 'text', value: 'exact marker' } },
      ]

      expect(verifyCourseSources(parseCourseManifest(raw), root)).toHaveLength(4)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports stale anchors and rejects symlink escapes', async () => {
    const stale = fixture()
    stale.units[0]!.sources[0]!.anchor.value = 'Missing heading'
    expect(() => verifyCourseSources(parseCourseManifest(stale), dshRoot)).toThrow(/source anchor heading.*is missing/)

    const parent = await mkdtemp(resolve(tmpdir(), 'learn-dsh-source-root-'))
    try {
      const root = resolve(parent, 'root')
      const outside = resolve(parent, 'outside.ts')
      await mkdir(root)
      await writeFile(outside, 'outside marker\n')
      await symlink(outside, resolve(root, 'escape.ts'))
      const escaped = fixture()
      escaped.units[0]!.sources = [{
        ...escaped.units[0]!.sources[0]!,
        path: 'escape.ts',
        anchor: { kind: 'text', value: 'outside marker' },
      }]

      expect(() => verifyCourseSources(parseCourseManifest(escaped), root)).toThrow(/resolves outside root/)
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})

describe('F-003 Q-001 curriculum service lifecycle', () => {
  it('registers immutable curriculum data and can be cleanly reloaded after dispose', async () => {
    const ctx = new Context()
    const config = { dshVersion: '0.1.0-rc.5', sourceRoot: dshRoot }
    const first = await ctx.plugin(CurriculumService, config)

    expect(ctx.curriculum.course().id).toBe('dsh-foundations')
    expect(ctx.curriculum.unit(UnitId('plugin-context-service-effect')).title).toContain('Plugin')
    expect(ctx.curriculum.sourceVerification).toHaveLength(3)
    expect(() => ctx.curriculum.course(CourseId('missing-course'))).toThrow(CurriculumValidationError)
    expect(() => ctx.curriculum.unit(UnitId('missing-unit'))).toThrow(CurriculumValidationError)
    expect(() => UnitId('Invalid Unit')).toThrow(/invalid id/)

    await first.dispose()
    const second = await ctx.plugin(CurriculumService, config)
    expect(ctx.curriculum.course().id).toBe('dsh-foundations')
    await second.dispose()
    await ctx.fiber.dispose()
  })
})
