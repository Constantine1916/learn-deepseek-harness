/** Local fsynced JSONL Provider for `ctx.learnerMemory`. */

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path'
import { lstat, mkdir, open, readFile, realpath } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import LearnerMemory, {
  LearnerMemoryError,
  parseLearnerEventEnvelope,
  prepareLearnerEvent,
  type CommandId,
  type EventId,
  type LearnerEventDraft,
  type LearnerEventEnvelope,
  type LearnerMemoryAppendResult,
  type LearnerScope,
} from './index.js'

export interface Config {
  /** Dedicated root for learner-memory artifacts. Required and resolved once. */
  root: string
  /** Roots that learner memory must not equal or enter, such as a DSH source checkout. */
  forbiddenRoots?: string[]
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
  forbiddenRoots: z.array(z.string()).default([]),
})

interface StreamState {
  readonly events: LearnerEventEnvelope[]
  readonly eventIds: Map<EventId, LearnerEventEnvelope>
  readonly commandIds: Map<CommandId, LearnerEventEnvelope>
}

function scopeKey(scope: LearnerScope): string {
  return `${scope.learnerId}\u0000${scope.enrollmentId}`
}

function equalJson(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => equalJson(value, right[index]))
  }
  if (left !== null && right !== null && typeof left === 'object' && typeof right === 'object') {
    const leftEntries = Object.entries(left)
    const rightRecord = right as Record<string, unknown>
    return leftEntries.length === Object.keys(rightRecord).length
      && leftEntries.every(([key, value]) => Object.hasOwn(rightRecord, key) && equalJson(value, rightRecord[key]))
  }
  return false
}

function sameSemanticEvent(event: LearnerEventEnvelope, draft: LearnerEventDraft, requireEventId: boolean): boolean {
  return (!requireEventId || event.eventId === draft.eventId)
    && event.learnerId === draft.learnerId
    && event.enrollmentId === draft.enrollmentId
    && event.sourceSessionId === draft.sourceSessionId
    && event.type === draft.type
    && event.version === draft.version
    && equalJson(event.data, draft.data)
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

/** Fsynced local Provider. One stream has one serialized operation chain. */
export class LocalLearnerMemory extends LearnerMemory {
  static Config = Config

  override readonly name = 'learn-dsh-learner-memory-local'

  private readonly configuredRoot: string
  private forbiddenRoots: string[]
  private root?: string
  private accepting = true
  private readonly streams = new Map<string, Promise<StreamState>>()
  private readonly tails = new Map<string, Promise<void>>()

  constructor(ctx: Context, config: Config) {
    super(ctx)
    if (typeof config.root !== 'string' || config.root.length === 0) {
      throw new LearnerMemoryError('unsafe-root', 'learner-memory root must be a non-empty string')
    }
    this.configuredRoot = resolve(config.root)
    this.forbiddenRoots = (config.forbiddenRoots ?? []).map(path => resolve(path))
    this.validateConfiguredRoot()
  }

  protected async [Service.init](): Promise<void> {
    this.forbiddenRoots = await Promise.all(this.forbiddenRoots.map(async path => {
      try {
        return await realpath(path)
      } catch (error) {
        if (isMissing(error)) return path
        throw new LearnerMemoryError('unsafe-root', `cannot resolve forbidden root "${path}"`, { cause: error })
      }
    }))
    await mkdir(this.configuredRoot, { recursive: true, mode: 0o700 })
    this.root = await realpath(this.configuredRoot)
    this.validateResolvedRoot(this.root)
    this.ctx.effect(() => async () => {
      this.accepting = false
      await Promise.all(this.tails.values())
    }, 'learner-memory.local.drain')
  }

  private validateConfiguredRoot(): void {
    if (!isAbsolute(this.configuredRoot) || this.configuredRoot === parse(this.configuredRoot).root) {
      throw new LearnerMemoryError('unsafe-root', `learner-memory root "${this.configuredRoot}" is unsafe`)
    }
    this.validateResolvedRoot(this.configuredRoot)
  }

  private validateResolvedRoot(root: string): void {
    const home = resolve(homedir())
    if (root === home) throw new LearnerMemoryError('unsafe-root', `learner-memory root must not be the HOME root "${home}"`)
    for (const forbidden of this.forbiddenRoots) {
      const offset = relative(forbidden, root)
      if (offset === '' || (!offset.startsWith(`..${sep}`) && offset !== '..' && !isAbsolute(offset))) {
        throw new LearnerMemoryError('unsafe-root', `learner-memory root "${root}" is inside forbidden root "${forbidden}"`)
      }
    }
  }

  private requireRoot(): string {
    if (this.root === undefined) throw new LearnerMemoryError('closed', 'learner-memory Provider is not ready')
    return this.root
  }

  override locate(scope: LearnerScope): string {
    const digest = createHash('sha256').update(scopeKey(scope)).digest('hex')
    return resolve(this.requireRoot(), digest.slice(0, 2), `${digest}.jsonl`)
  }

  private async load(scope: LearnerScope): Promise<StreamState> {
    const key = scopeKey(scope)
    const existing = this.streams.get(key)
    if (existing !== undefined) return existing
    const loading = this.loadFromDisk(scope)
    this.streams.set(key, loading)
    try {
      return await loading
    } catch (error) {
      this.streams.delete(key)
      throw error
    }
  }

  private async loadFromDisk(scope: LearnerScope): Promise<StreamState> {
    const path = this.locate(scope)
    let text: string
    try {
      const info = await lstat(path)
      if (info.isSymbolicLink()) throw new LearnerMemoryError('corrupt', `learner-memory artifact "${path}" must not be a symbolic link`)
      text = await readFile(path, 'utf8')
    } catch (error) {
      if (isMissing(error)) return { events: [], eventIds: new Map(), commandIds: new Map() }
      if (error instanceof LearnerMemoryError) throw error
      throw new LearnerMemoryError('corrupt', `cannot read learner-memory artifact "${path}"`, { cause: error })
    }
    if (text.length > 0 && !text.endsWith('\n')) {
      throw new LearnerMemoryError('corrupt', `learner-memory artifact "${path}" ends with a torn record`)
    }
    const state: StreamState = { events: [], eventIds: new Map(), commandIds: new Map() }
    const lines = text.length === 0 ? [] : text.slice(0, -1).split('\n')
    lines.forEach((line, index) => {
      let raw: unknown
      try {
        raw = JSON.parse(line)
      } catch (error) {
        throw new LearnerMemoryError('corrupt', `learner-memory artifact "${path}" line ${String(index + 1)} is not valid JSON`, { cause: error })
      }
      const event = parseLearnerEventEnvelope(raw, `learner-memory artifact "${path}" line ${String(index + 1)}`)
      if (event.learnerId !== scope.learnerId || event.enrollmentId !== scope.enrollmentId) {
        throw new LearnerMemoryError('identity-mismatch', `learner-memory artifact "${path}" contains an event for another learner or enrollment`)
      }
      if (event.seq !== index) {
        throw new LearnerMemoryError('sequence-gap', `learner-memory artifact "${path}" expected seq ${String(index)} but found ${String(event.seq)}`)
      }
      if (state.eventIds.has(event.eventId)) throw new LearnerMemoryError('corrupt', `learner-memory artifact "${path}" repeats EventId "${event.eventId}"`)
      if (event.commandId !== undefined && state.commandIds.has(event.commandId)) {
        throw new LearnerMemoryError('corrupt', `learner-memory artifact "${path}" repeats CommandId "${event.commandId}"`)
      }
      state.events.push(event)
      state.eventIds.set(event.eventId, event)
      if (event.commandId !== undefined) state.commandIds.set(event.commandId, event)
    })
    return state
  }

  private enqueue<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new LearnerMemoryError('closed', 'learner-memory Provider is closing'))
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.then(operation, operation)
    const settled = result.then(() => undefined, () => undefined)
    this.tails.set(key, settled)
    void settled.finally(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key)
    })
    return result
  }

  override append(input: LearnerEventDraft): Promise<LearnerMemoryAppendResult> {
    const draft = prepareLearnerEvent(input)
    const key = scopeKey(draft)
    return this.enqueue(key, async () => {
      const state = await this.load(draft)
      const byEventId = state.eventIds.get(draft.eventId)
      if (byEventId !== undefined) {
        if (!sameSemanticEvent(byEventId, draft, true)) {
          throw new LearnerMemoryError('idempotency-conflict', `EventId "${draft.eventId}" already names a different learner event`)
        }
        return Object.freeze({ event: byEventId, appended: false })
      }
      if (draft.commandId !== undefined) {
        const byCommandId = state.commandIds.get(draft.commandId)
        if (byCommandId !== undefined) {
          if (!sameSemanticEvent(byCommandId, draft, false)) {
            throw new LearnerMemoryError('idempotency-conflict', `CommandId "${draft.commandId}" already names a different learner event`)
          }
          return Object.freeze({ event: byCommandId, appended: false })
        }
      }

      const event = parseLearnerEventEnvelope({ ...draft, seq: state.events.length, time: Date.now() }, 'candidate learner event')
      const path = this.locate(draft)
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      const parent = await realpath(dirname(path))
      const root = this.requireRoot()
      const offset = relative(root, parent)
      if (offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
        throw new LearnerMemoryError('unsafe-root', `learner-memory stream directory "${parent}" escaped root "${root}"`)
      }
      const handle = await open(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try {
        await handle.write(`${JSON.stringify(event)}\n`)
        await handle.sync()
      } finally {
        await handle.close()
      }
      state.events.push(event)
      state.eventIds.set(event.eventId, event)
      if (event.commandId !== undefined) state.commandIds.set(event.commandId, event)
      return Object.freeze({ event, appended: true })
    })
  }

  override async read(scope: LearnerScope): Promise<readonly LearnerEventEnvelope[]> {
    const key = scopeKey(scope)
    await this.tails.get(key)
    const state = await this.load(scope)
    return Object.freeze([...state.events])
  }

  override async flush(scope?: LearnerScope): Promise<void> {
    if (scope === undefined) await Promise.all(this.tails.values())
    else await this.tails.get(scopeKey(scope))
  }
}

export default LocalLearnerMemory
