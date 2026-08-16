/** Local sandboxed Provider for the Learn DSH lab capability. */

import { createHash } from 'node:crypto'
import { dirname, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import type { CurriculumExerciseCheck } from '@learn-dsh/curriculum'
import type { CheckResult } from '@learn-dsh/learner'
import Lab, { LabError, type LabAttempt, type LabAttemptRequest } from './index.js'

export interface Config {
  /** Relative path under the calling Session cwd, or an absolute contained path. */
  workspaceRoot?: string
  /** Trusted root containing packaged exercise fixtures. */
  fixtureRoot?: string
}

export const Config: z<Config> = z.object({
  workspaceRoot: z.string().default('.learn-dsh/attempts'),
  fixtureRoot: z.string(),
})

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultFixtureRoot = resolve(packageRoot, 'fixtures')
const helperPath = resolve(packageRoot, 'scripts/prepare-attempt.mjs')
const MARKER_NAME = '.learn-dsh-attempt.json'

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function collectedText(result: ShellRunResult): string {
  const stderr = result.stderr.text.trim()
  return stderr.length === 0 ? result.stdout.text.trim() : `${result.stdout.text.trim()}\n${stderr}`.trim()
}

function resolveOptions(signal: AbortSignal | undefined, cwd?: string): { cwd?: string, signal?: AbortSignal } {
  return {
    ...(cwd === undefined ? {} : { cwd }),
    ...(signal === undefined ? {} : { signal }),
  }
}

function attemptSegment(request: LabAttemptRequest): string {
  return createHash('sha256')
    .update(`${request.scope.learnerId}\0${request.scope.enrollmentId}\0${request.attemptId}`)
    .digest('hex')
    .slice(0, 24)
}

function marker(request: LabAttemptRequest): Readonly<Record<string, string>> {
  return Object.freeze({
    learnerId: request.scope.learnerId,
    enrollmentId: request.scope.enrollmentId,
    unitId: request.unit.id,
    exerciseId: request.exercise.id,
    attemptId: request.attemptId,
  })
}

function parseCheckPayload(text: string): { summary: string, details: string[], artifacts: string[] } | undefined {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (typeof value.summary !== 'string' || !Array.isArray(value.details) || !Array.isArray(value.artifacts)) return undefined
    if (!value.details.every(item => typeof item === 'string') || !value.artifacts.every(item => typeof item === 'string')) return undefined
    return { summary: value.summary, details: value.details as string[], artifacts: value.artifacts as string[] }
  } catch {
    return undefined
  }
}

/** Sandboxed local attempt Provider. */
export class LocalLab extends Lab {
  static inject = ['fs', 'shell', 'sandboxPolicy']
  static Config = Config

  private readonly workspaceRoot: string
  private readonly fixtureRoot: string

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    this.workspaceRoot = config.workspaceRoot ?? '.learn-dsh/attempts'
    this.fixtureRoot = resolve(config.fixtureRoot ?? defaultFixtureRoot)
    if (this.workspaceRoot.trim().length === 0) throw new LabError('invalid-config', 'lab workspaceRoot must be non-empty')
    if (this.fixtureRoot === parse(this.fixtureRoot).root) throw new LabError('invalid-config', 'lab fixtureRoot cannot be a filesystem root')
  }

  private requireCwd(session: Session): string {
    const cwd = session.header.cwd
    if (cwd === undefined) throw new LabError('invalid-config', 'learning lab requires a Session cwd')
    return cwd
  }

  private async resolveRoots(request: LabAttemptRequest): Promise<{ workspaceRoot: string, fixturePath: string }> {
    const cwd = this.requireCwd(request.session)
    const cwdTarget = await this.ctx.fs.resolve(cwd, resolveOptions(request.signal))
    const rootTarget = await this.ctx.fs.resolve(this.workspaceRoot, resolveOptions(request.signal, cwd))
    if (!this.ctx.fs.contains(cwdTarget, rootTarget) || cwdTarget.targetKey === rootTarget.targetKey) {
      throw new LabError('unsafe-path', `lab workspace root must be a child of the Session cwd: "${rootTarget.displayPath}"`)
    }

    const fixtureRoot = await this.ctx.fs.resolve(this.fixtureRoot, resolveOptions(request.signal))
    const fixture = await this.ctx.fs.resolve(request.exercise.fixture, resolveOptions(request.signal, this.fixtureRoot))
    if (!this.ctx.fs.contains(fixtureRoot, fixture) || fixtureRoot.targetKey === fixture.targetKey) {
      throw new LabError('unsafe-path', `exercise fixture resolves outside the configured fixture root: "${request.exercise.fixture}"`)
    }
    const fixtureInfo = await this.ctx.fs.stat(fixture, request.signal)
    if (fixtureInfo?.type !== 'directory') throw new LabError('invalid-config', `exercise fixture is not a directory: "${request.exercise.fixture}"`)
    return {
      workspaceRoot: this.ctx.fs.processPath(rootTarget),
      fixturePath: this.ctx.fs.processPath(fixture),
    }
  }

  private async attemptFor(request: LabAttemptRequest): Promise<{ attempt: LabAttempt, fixturePath: string, workspaceRoot: string }> {
    const roots = await this.resolveRoots(request)
    const workspacePath = resolve(roots.workspaceRoot, attemptSegment(request))
    return {
      ...roots,
      attempt: Object.freeze({
        attemptId: request.attemptId,
        exerciseId: request.exercise.id,
        unitId: request.unit.id,
        workspacePath,
      }),
    }
  }

  private async prepare(operation: 'create' | 'reset', request: LabAttemptRequest): Promise<LabAttempt> {
    const { attempt, fixturePath, workspaceRoot } = await this.attemptFor(request)
    const policy = this.ctx.sandboxPolicy.resolve({ session: request.session })
    const spec = this.ctx.shell.resolve({
      command: `${shellQuote(process.execPath)} ${shellQuote(helperPath)}`,
      workdir: this.requireCwd(request.session),
      timeoutMs: 30_000,
      stdoutMaxBytes: 64 * 1024,
      signal: request.signal,
      sandboxPolicy: policy,
      stdin: JSON.stringify({
        operation,
        root: workspaceRoot,
        target: attempt.workspacePath,
        fixture: fixturePath,
        marker: marker(request),
      }),
    })
    const result = await this.ctx.shell.run(spec)
    if (result.sandbox?.denied === true) throw new LabError('blocked', `lab workspace preparation was denied by ${result.sandbox.mode} policy`)
    if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.aborted) {
      throw new LabError('blocked', `lab workspace preparation failed: ${collectedText(result) || 'no diagnostic output'}`)
    }
    await this.verifyMarker(attempt, request)
    return attempt
  }

  private async verifyMarker(attempt: LabAttempt, request: LabAttemptRequest): Promise<void> {
    const attemptTarget = await this.ctx.fs.resolve(attempt.workspacePath, resolveOptions(request.signal))
    const rootTarget = await this.ctx.fs.resolve(this.workspaceRoot, resolveOptions(request.signal, this.requireCwd(request.session)))
    if (!this.ctx.fs.contains(rootTarget, attemptTarget) || rootTarget.targetKey === attemptTarget.targetKey) {
      throw new LabError('unsafe-path', 'resolved attempt directory is outside the lab workspace root')
    }
    const markerTarget = await this.ctx.fs.resolve(MARKER_NAME, resolveOptions(request.signal, attempt.workspacePath))
    let parsed: unknown
    try {
      parsed = JSON.parse(await this.ctx.fs.readText(markerTarget, request.signal))
    } catch (cause) {
      throw new LabError('invalid-attempt', 'attempt identity marker is missing or malformed', { cause })
    }
    if (JSON.stringify(parsed) !== JSON.stringify(marker(request))) {
      throw new LabError('invalid-attempt', 'attempt identity marker does not match the requested scope')
    }
  }

  override createAttempt(request: LabAttemptRequest): Promise<LabAttempt> {
    return this.prepare('create', request)
  }

  override resetAttempt(request: LabAttemptRequest): Promise<LabAttempt> {
    return this.prepare('reset', request)
  }

  private blocked(check: CurriculumExerciseCheck, category: CheckResult['category'], summary: string, details: string[] = []): CheckResult {
    return Object.freeze({ checkId: check.id, status: 'blocked', category, summary, details: Object.freeze(details), artifacts: Object.freeze([]) })
  }

  private async runCheck(attempt: LabAttempt, request: LabAttemptRequest, check: CurriculumExerciseCheck): Promise<CheckResult> {
    const entryTarget = await this.ctx.fs.resolve(check.entry, resolveOptions(request.signal, attempt.workspacePath))
    const attemptTarget = await this.ctx.fs.resolve(attempt.workspacePath, resolveOptions(request.signal))
    if (!this.ctx.fs.contains(attemptTarget, entryTarget) || attemptTarget.targetKey === entryTarget.targetKey) {
      return this.blocked(check, 'safety', 'Check entry resolved outside the attempt workspace')
    }
    const entryInfo = await this.ctx.fs.stat(entryTarget, request.signal)
    if (entryInfo?.type !== 'file') return this.blocked(check, 'configuration', `Check entry is missing: ${check.entry}`)

    try {
      const result = await this.ctx.shell.run(this.ctx.shell.resolve({
        command: `${shellQuote(process.execPath)} ${shellQuote(this.ctx.fs.processPath(entryTarget))}`,
        workdir: attempt.workspacePath,
        timeoutMs: check.timeoutMs,
        stdoutMaxBytes: 64 * 1024,
        signal: request.signal,
        sandboxPolicy: this.ctx.sandboxPolicy.resolve({ session: request.session }),
      }))
      if (result.sandbox?.denied === true) return this.blocked(check, 'safety', `Check was denied by ${result.sandbox.mode} policy`)
      if (result.timedOut || result.aborted || result.signal !== null) {
        return this.blocked(check, 'environment', 'Check process did not complete', [collectedText(result)].filter(Boolean))
      }
      const payload = parseCheckPayload(result.stdout.text.trim())
      if (payload === undefined) {
        return this.blocked(check, 'configuration', 'Check returned malformed structured output', [collectedText(result)].filter(Boolean))
      }
      return Object.freeze({
        checkId: check.id,
        status: result.exitCode === 0 ? 'passed' : 'failed',
        category: check.category,
        summary: payload.summary,
        details: Object.freeze([...payload.details, ...result.stderr.text.trim() === '' ? [] : [result.stderr.text.trim()]]),
        artifacts: Object.freeze([...payload.artifacts]),
      })
    } catch (error) {
      return this.blocked(check, 'environment', 'Check infrastructure failed', [error instanceof Error ? error.message : String(error)])
    }
  }

  override async runChecks(request: LabAttemptRequest): Promise<readonly CheckResult[]> {
    const { attempt } = await this.attemptFor(request)
    await this.verifyMarker(attempt, request)
    const results: CheckResult[] = []
    for (const check of request.exercise.checks) results.push(await this.runCheck(attempt, request, check))
    return Object.freeze(results)
  }
}

export default LocalLab
