/**
 * Versioned curriculum schema, graph validation, and source-anchor resolution.
 *
 * @module @learn-dsh/curriculum
 */

import { readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { load } from 'js-yaml'
import { satisfies, valid, validRange } from 'semver'

declare module '@deepseek-ai/cordis' {
  interface Context {
    curriculum: CurriculumService
  }
}

/** Cordis plugin name used in diagnostics. */
export const name = 'learn-dsh-curriculum'

/** Current on-disk manifest schema. */
export const COURSE_SCHEMA_VERSION = 1 as const

/** Nominal identity carried across curriculum and learner packages. */
export type CourseId = string & { readonly __courseId: unique symbol }

/** Nominal unit identity, unique within a course. */
export type UnitId = string & { readonly __unitId: unique symbol }

/** Nominal learning-outcome identity, unique within a course. */
export type LearningOutcomeId = string & { readonly __learningOutcomeId: unique symbol }

/** Nominal checkpoint identity, unique within a unit. */
export type CheckpointId = string & { readonly __checkpointId: unique symbol }

/** Nominal exercise identity, unique within a unit. */
export type ExerciseId = string & { readonly __exerciseId: unique symbol }

/** Nominal rubric identity, unique within a unit. */
export type RubricId = string & { readonly __rubricId: unique symbol }

export type EvidenceKind = 'authored' | 'machine' | 'observed'
export type ExerciseKind = 'source-inspection' | 'code' | 'integration'
export type SourceAnchorKind = 'heading' | 'text' | 'export' | 'test'
export type ExerciseCheckCategory = 'implementation' | 'configuration' | 'environment' | 'safety'

const ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

function brandedId<T extends string>(value: string, label: string): T {
  if (!ID_PATTERN.test(value)) throw new CurriculumValidationError(`${label} has invalid id "${value}"`)
  return value as T
}

/** Validate and brand a course ID at an API boundary. */
export function CourseId(value: string): CourseId {
  return brandedId<CourseId>(value, 'course')
}

/** Validate and brand a unit ID at an API boundary. */
export function UnitId(value: string): UnitId {
  return brandedId<UnitId>(value, 'unit')
}

export interface LearningOutcome {
  readonly id: LearningOutcomeId
  readonly description: string
}

export interface SourceAnchor {
  readonly repository: 'deepseek-harness'
  readonly version: string
  readonly path: string
  readonly anchor: {
    readonly kind: SourceAnchorKind
    readonly value: string
  }
  readonly purpose: string
}

export interface CurriculumCheckpoint {
  readonly id: CheckpointId
  readonly title: string
  readonly evidenceKind: EvidenceKind
}

export interface CurriculumExercise {
  readonly id: ExerciseId
  readonly title: string
  readonly kind: ExerciseKind
  readonly fixture: string
  readonly checks: readonly CurriculumExerciseCheck[]
}

export interface CurriculumExerciseCheck {
  readonly id: string
  readonly runner: 'node'
  readonly entry: string
  readonly timeoutMs: number
  readonly category: ExerciseCheckCategory
}

export interface CurriculumHint {
  readonly level: 1 | 2 | 3
  readonly text: string
}

export interface CurriculumRubricItem {
  readonly id: RubricId
  readonly criterion: string
  readonly evidenceKinds: readonly EvidenceKind[]
}

export interface CompletionRule {
  readonly requiredCheckpointIds: readonly CheckpointId[]
  readonly requiredExerciseIds: readonly ExerciseId[]
  readonly requiredRubricIds: readonly RubricId[]
}

export interface CurriculumUnit {
  readonly id: UnitId
  readonly title: string
  readonly outcomeIds: readonly LearningOutcomeId[]
  readonly objectives: readonly string[]
  readonly prerequisites: readonly UnitId[]
  readonly dshVersionRange: string
  readonly contentEntry: string
  readonly sources: readonly SourceAnchor[]
  readonly checkpoints: readonly CurriculumCheckpoint[]
  readonly exercises: readonly CurriculumExercise[]
  readonly hints: readonly CurriculumHint[]
  readonly rubric: readonly CurriculumRubricItem[]
  readonly completion: CompletionRule
}

export interface CourseManifest {
  readonly schemaVersion: typeof COURSE_SCHEMA_VERSION
  readonly id: CourseId
  readonly version: string
  readonly title: string
  readonly locale: string
  readonly dshVersionRange: string
  readonly learningOutcomes: readonly LearningOutcome[]
  readonly units: readonly CurriculumUnit[]
}

interface RawCourseManifest {
  schemaVersion: 1
  id: string
  version: string
  title: string
  locale: string
  dshVersionRange: string
  learningOutcomes: Array<{ id: string, description: string }>
  units: Array<{
    id: string
    title: string
    outcomeIds: string[]
    objectives: string[]
    prerequisites: string[]
    dshVersionRange: string
    contentEntry: string
    sources: Array<{
      repository: 'deepseek-harness'
      version: string
      path: string
      anchor: { kind: SourceAnchorKind, value: string }
      purpose: string
    }>
    checkpoints: Array<{ id: string, title: string, evidenceKind: EvidenceKind }>
    exercises: Array<{
      id: string
      title: string
      kind: ExerciseKind
      fixture: string
      checks: Array<{
        id: string
        runner: 'node'
        entry: string
        timeoutMs: number
        category: ExerciseCheckCategory
      }>
    }>
    hints: Array<{ level: 1 | 2 | 3, text: string }>
    rubric: Array<{ id: string, criterion: string, evidenceKinds: EvidenceKind[] }>
    completion: {
      requiredCheckpointIds: string[]
      requiredExerciseIds: string[]
      requiredRubricIds: string[]
    }
  }>
}

const idSchema = z.string().min(1).pattern(ID_PATTERN).required()
const nonEmptyString = z.string().min(1).required()
const evidenceKindSchema = z.union(['authored', 'machine', 'observed'] as const).required()

/** Runtime shape schema. Semantic graph and source checks run after this parse. */
export const CourseManifestSchema: z<RawCourseManifest> = z.object({
  schemaVersion: z.const(COURSE_SCHEMA_VERSION).required(),
  id: idSchema,
  version: nonEmptyString,
  title: nonEmptyString,
  locale: nonEmptyString,
  dshVersionRange: nonEmptyString,
  learningOutcomes: z.array(z.object({
    id: idSchema,
    description: nonEmptyString,
  }).required()).min(1).required(),
  units: z.array(z.object({
    id: idSchema,
    title: nonEmptyString,
    outcomeIds: z.array(idSchema).min(1).required(),
    objectives: z.array(nonEmptyString).min(1).required(),
    prerequisites: z.array(idSchema).required(),
    dshVersionRange: nonEmptyString,
    contentEntry: nonEmptyString,
    sources: z.array(z.object({
      repository: z.const('deepseek-harness').required(),
      version: nonEmptyString,
      path: nonEmptyString,
      anchor: z.object({
        kind: z.union(['heading', 'text', 'export', 'test'] as const).required(),
        value: nonEmptyString,
      }).required(),
      purpose: nonEmptyString,
    }).required()).min(1).required(),
    checkpoints: z.array(z.object({
      id: idSchema,
      title: nonEmptyString,
      evidenceKind: evidenceKindSchema,
    }).required()).min(1).required(),
    exercises: z.array(z.object({
      id: idSchema,
      title: nonEmptyString,
      kind: z.union(['source-inspection', 'code', 'integration'] as const).required(),
      fixture: nonEmptyString,
      checks: z.array(z.object({
        id: idSchema,
        runner: z.const('node').required(),
        entry: nonEmptyString,
        timeoutMs: z.number().step(1).min(1).required(),
        category: z.union(['implementation', 'configuration', 'environment', 'safety'] as const).required(),
      }).required()).min(1).required(),
    }).required()).min(1).required(),
    hints: z.array(z.object({
      level: z.union([z.const(1), z.const(2), z.const(3)]).required(),
      text: nonEmptyString,
    }).required()).min(3).max(3).required(),
    rubric: z.array(z.object({
      id: idSchema,
      criterion: nonEmptyString,
      evidenceKinds: z.array(evidenceKindSchema).min(1).required(),
    }).required()).min(1).required(),
    completion: z.object({
      requiredCheckpointIds: z.array(idSchema).min(1).required(),
      requiredExerciseIds: z.array(idSchema).min(1).required(),
      requiredRubricIds: z.array(idSchema).min(1).required(),
    }).required(),
  }).required()).min(1).required(),
}).required()

/** Validation failure at the persistent curriculum input boundary. */
export class CurriculumValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CurriculumValidationError'
  }
}

/** A successfully resolved source anchor. */
export interface SourceVerification {
  readonly unitId: UnitId
  readonly path: string
  readonly anchorKind: SourceAnchorKind
  readonly anchor: string
  readonly version: string
}

function duplicate(values: readonly string[]): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return undefined
}

function requireUnique(values: readonly string[], label: string): void {
  const repeated = duplicate(values)
  if (repeated !== undefined) throw new CurriculumValidationError(`${label} contains duplicate id "${repeated}"`)
}

function requireSemverRange(range: string, label: string): void {
  if (validRange(range) === null) throw new CurriculumValidationError(`${label} has unsupported SemVer range "${range}"`)
}

function requireSafeRelativePath(value: string, label: string): void {
  const normalized = posix.normalize(value)
  if (value.includes('\\') || isAbsolute(value) || normalized === '..' || normalized.startsWith('../') || normalized.startsWith('/')) {
    throw new CurriculumValidationError(`${label} must stay inside its declared root: "${value}"`)
  }
}

function requireReferences(values: readonly string[], available: ReadonlySet<string>, label: string): void {
  requireUnique(values, label)
  for (const value of values) {
    if (!available.has(value)) throw new CurriculumValidationError(`${label} references missing id "${value}"`)
  }
}

function validateGraph(units: readonly RawCourseManifest['units'][number][]): void {
  const unitIds = new Set(units.map(unit => unit.id))
  for (const unit of units) requireReferences(unit.prerequisites, unitIds, `unit "${unit.id}" prerequisites`)

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(units.map(unit => [unit.id, unit] as const))
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new CurriculumValidationError(`curriculum graph contains a cycle at unit "${id}"`)
    if (visited.has(id)) return
    visiting.add(id)
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) visit(prerequisite)
    visiting.delete(id)
    visited.add(id)
  }
  for (const unit of units) visit(unit.id)
}

function validateSemantics(raw: RawCourseManifest): void {
  if (valid(raw.version) === null) throw new CurriculumValidationError(`course version must be an exact SemVer: "${raw.version}"`)
  requireSemverRange(raw.dshVersionRange, 'course')
  requireUnique(raw.learningOutcomes.map(outcome => outcome.id), 'learningOutcomes')
  requireUnique(raw.units.map(unit => unit.id), 'units')
  const outcomeIds = new Set(raw.learningOutcomes.map(outcome => outcome.id))

  for (const unit of raw.units) {
    requireSemverRange(unit.dshVersionRange, `unit "${unit.id}"`)
    requireSafeRelativePath(unit.contentEntry, `unit "${unit.id}" contentEntry`)
    requireReferences(unit.outcomeIds, outcomeIds, `unit "${unit.id}" outcomeIds`)
    requireUnique(unit.objectives, `unit "${unit.id}" objectives`)
    requireUnique(unit.sources.map(source => `${source.path}#${source.anchor.kind}:${source.anchor.value}`), `unit "${unit.id}" sources`)
    for (const source of unit.sources) {
      requireSafeRelativePath(source.path, `unit "${unit.id}" source path`)
      if (!/^[0-9a-f]{40}$/.test(source.version)) {
        throw new CurriculumValidationError(`unit "${unit.id}" source version must be a full git commit: "${source.version}"`)
      }
    }

    const checkpointIds = unit.checkpoints.map(checkpoint => checkpoint.id)
    const exerciseIds = unit.exercises.map(exercise => exercise.id)
    const rubricIds = unit.rubric.map(item => item.id)
    requireUnique(checkpointIds, `unit "${unit.id}" checkpoints`)
    requireUnique(exerciseIds, `unit "${unit.id}" exercises`)
    for (const exercise of unit.exercises) {
      requireSafeRelativePath(exercise.fixture, `unit "${unit.id}" exercise "${exercise.id}" fixture`)
      requireUnique(exercise.checks.map(check => check.id), `unit "${unit.id}" exercise "${exercise.id}" checks`)
      for (const check of exercise.checks) {
        requireSafeRelativePath(check.entry, `unit "${unit.id}" exercise "${exercise.id}" check "${check.id}" entry`)
        if (!Number.isSafeInteger(check.timeoutMs) || check.timeoutMs < 1) {
          throw new CurriculumValidationError(`unit "${unit.id}" exercise "${exercise.id}" check "${check.id}" timeoutMs must be a positive safe integer`)
        }
      }
    }
    requireUnique(rubricIds, `unit "${unit.id}" rubric`)
    requireReferences(unit.completion.requiredCheckpointIds, new Set(checkpointIds), `unit "${unit.id}" completion.requiredCheckpointIds`)
    requireReferences(unit.completion.requiredExerciseIds, new Set(exerciseIds), `unit "${unit.id}" completion.requiredExerciseIds`)
    requireReferences(unit.completion.requiredRubricIds, new Set(rubricIds), `unit "${unit.id}" completion.requiredRubricIds`)
    for (const item of unit.rubric) requireUnique(item.evidenceKinds, `unit "${unit.id}" rubric "${item.id}" evidenceKinds`)
    const levels = unit.hints.map(hint => hint.level)
    if (levels[0] !== 1 || levels[1] !== 2 || levels[2] !== 3) {
      throw new CurriculumValidationError(`unit "${unit.id}" hints must contain levels 1, 2, and 3 in order`)
    }
    for (const hint of unit.hints.slice(0, 2)) {
      if (hint.text.length > 280) throw new CurriculumValidationError(`unit "${unit.id}" hint level ${String(hint.level)} exceeds the progressive-disclosure budget`)
      if (hint.text.includes('```') || /(?:完整|complete|reference)\s*(?:参考)?\s*(?:实现|solution|implementation)/iu.test(hint.text)) {
        throw new CurriculumValidationError(`unit "${unit.id}" hint level ${String(hint.level)} must not reveal a complete implementation`)
      }
    }
  }
  validateGraph(raw.units)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested)
    Object.freeze(value)
  }
  return value
}

/** Parse untrusted YAML/JSON data and validate all graph-level invariants. */
export function parseCourseManifest(input: unknown): CourseManifest {
  let raw: RawCourseManifest
  try {
    raw = CourseManifestSchema(input as RawCourseManifest)
  } catch (cause) {
    throw new CurriculumValidationError(`course manifest does not match schema: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
  validateSemantics(raw)
  return deepFreeze(raw as unknown as CourseManifest)
}

function resolveInsideRoot(root: string, path: string, label: string): string {
  const realRoot = realpathSync(root)
  const candidate = realpathSync(resolve(realRoot, path))
  const offset = relative(realRoot, candidate)
  if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw new CurriculumValidationError(`${label} resolves outside root "${realRoot}"`)
  }
  return candidate
}

function verifyContentEntries(course: CourseManifest, manifestPath: string): void {
  const root = dirname(manifestPath)
  for (const unit of course.units) {
    try {
      resolveInsideRoot(root, unit.contentEntry, `unit "${unit.id}" contentEntry`)
    } catch (cause) {
      if (cause instanceof CurriculumValidationError) throw cause
      throw new CurriculumValidationError(`unit "${unit.id}" contentEntry "${unit.contentEntry}" cannot be resolved`, { cause })
    }
  }
}

/** Load and validate one YAML course manifest and its packaged content entries. */
export function loadCourseFile(manifestPath: string, dshVersion?: string): CourseManifest {
  let parsed: unknown
  try {
    parsed = load(readFileSync(manifestPath, 'utf8'))
  } catch (cause) {
    throw new CurriculumValidationError(`cannot read course manifest "${manifestPath}": ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
  const course = parseCourseManifest(parsed)
  verifyContentEntries(course, realpathSync(manifestPath))
  if (dshVersion !== undefined) assertCourseSupports(course, dshVersion)
  return course
}

/** Reject a selected runtime version outside the course and every unit range. */
export function assertCourseSupports(course: CourseManifest, dshVersion: string): void {
  if (valid(dshVersion) === null) throw new CurriculumValidationError(`selected DSH version is not exact SemVer: "${dshVersion}"`)
  if (!satisfies(dshVersion, course.dshVersionRange, { includePrerelease: true })) {
    throw new CurriculumValidationError(`course "${course.id}" does not support DSH ${dshVersion}; expected ${course.dshVersionRange}`)
  }
  for (const unit of course.units) {
    if (!satisfies(dshVersion, unit.dshVersionRange, { includePrerelease: true })) {
      throw new CurriculumValidationError(`unit "${unit.id}" does not support DSH ${dshVersion}; expected ${unit.dshVersionRange}`)
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function anchorMatches(text: string, anchor: SourceAnchor['anchor']): boolean {
  const escaped = escapeRegExp(anchor.value)
  switch (anchor.kind) {
    case 'heading': return new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, 'm').test(text)
    case 'export': return new RegExp(`\\bexport\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:class|function|const|let|var|interface|type|enum|namespace)\\s+${escaped}\\b`).test(text)
    case 'test': return new RegExp(`\\b(?:describe|it|test)\\(\\s*['"]${escaped}['"]`).test(text)
    case 'text': return text.includes(anchor.value)
  }
}

/** Resolve every declared DSH source path and stable anchor against a checkout. */
export function verifyCourseSources(course: CourseManifest, sourceRoot: string): readonly SourceVerification[] {
  const verified: SourceVerification[] = []
  for (const unit of course.units) {
    for (const source of unit.sources) {
      let sourcePath: string
      try {
        sourcePath = resolveInsideRoot(sourceRoot, source.path, `unit "${unit.id}" source "${source.path}"`)
      } catch (cause) {
        if (cause instanceof CurriculumValidationError) throw cause
        throw new CurriculumValidationError(`unit "${unit.id}" source "${source.path}" cannot be resolved`, { cause })
      }
      const text = readFileSync(sourcePath, 'utf8')
      if (!anchorMatches(text, source.anchor)) {
        throw new CurriculumValidationError(`unit "${unit.id}" source anchor ${source.anchor.kind} "${source.anchor.value}" is missing from "${source.path}" at ${source.version}`)
      }
      verified.push(deepFreeze({
        unitId: unit.id,
        path: source.path,
        anchorKind: source.anchor.kind,
        anchor: source.anchor.value,
        version: source.version,
      }))
    }
  }
  return deepFreeze(verified)
}

export interface Config {
  /** Manifest path. Relative values resolve from the host process cwd. */
  manifestPath?: string
  /** Selected DSH version to enforce at plugin load. */
  dshVersion?: string
  /** Optional DSH checkout root for eager source-anchor verification. */
  sourceRoot?: string
}

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultManifestPath = resolve(packageRoot, 'curriculum/foundations/course.yml')

function optionalConfigPath(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0) throw new CurriculumValidationError(`${label} must be a non-empty string`)
  return resolve(value)
}

/** Read-only curriculum service installed as `ctx.curriculum`. */
export class CurriculumService extends Service {
  readonly manifest: CourseManifest
  readonly sourceVerification: readonly SourceVerification[]

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'curriculum')
    const manifestPath = optionalConfigPath(config.manifestPath, 'manifestPath') ?? defaultManifestPath
    if (config.dshVersion !== undefined && (typeof config.dshVersion !== 'string' || config.dshVersion.length === 0)) {
      throw new CurriculumValidationError('dshVersion must be a non-empty string')
    }
    const sourceRoot = optionalConfigPath(config.sourceRoot, 'sourceRoot')
    this.manifest = loadCourseFile(manifestPath, config.dshVersion)
    this.sourceVerification = sourceRoot === undefined ? deepFreeze([]) : verifyCourseSources(this.manifest, sourceRoot)
  }

  /** Return the one currently loaded, immutable course. */
  course(id: CourseId = this.manifest.id): CourseManifest {
    if (id !== this.manifest.id) throw new CurriculumValidationError(`course "${id}" is not loaded`)
    return this.manifest
  }

  /** Resolve one immutable unit by branded ID. */
  unit(id: UnitId): CurriculumUnit {
    const unit = this.manifest.units.find(candidate => candidate.id === id)
    if (unit === undefined) throw new CurriculumValidationError(`unit "${id}" is not loaded`)
    return unit
  }

  /** Verify sources on demand when a checkout becomes resolvable. */
  verifySources(sourceRoot: string): readonly SourceVerification[] {
    return verifyCourseSources(this.manifest, sourceRoot)
  }
}

export default CurriculumService
