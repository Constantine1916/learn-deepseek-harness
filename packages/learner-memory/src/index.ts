/**
 * Learner Event Store Service Definition and durable envelope vocabulary.
 *
 * @module @learn-dsh/learner-memory
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    learnerMemory: LearnerMemory
  }
}

/** Current required learning-event payload version. */
export const LEARNER_EVENT_VERSION = 1 as const

/** Persistent learner identity resolved by a trusted host or identity Provider. */
export type LearnerId = string & { readonly __learnerId: unique symbol }
/** One course-learning relationship that can span many DSH Sessions. */
export type EnrollmentId = string & { readonly __enrollmentId: unique symbol }
/** Stable event identity used for durable idempotence. */
export type EventId = string & { readonly __eventId: unique symbol }
/** Optional stable command identity used when an event ID is not reused by a retrier. */
export type CommandId = string & { readonly __commandId: unique symbol }

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const EVENT_TYPE_PATTERN = /^learning\/[a-z][a-z0-9-]*$/

function brand<T extends string>(value: string, label: string): T {
  if (!ID_PATTERN.test(value)) throw new LearnerMemoryError('invalid-event', `${label} has invalid id "${value}"`)
  return value as T
}

export function LearnerId(value: string): LearnerId { return brand<LearnerId>(value, 'learner') }
export function EnrollmentId(value: string): EnrollmentId { return brand<EnrollmentId>(value, 'enrollment') }
export function EventId(value: string): EventId { return brand<EventId>(value, 'event') }
export function CommandId(value: string): CommandId { return brand<CommandId>(value, 'command') }

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Logical key of one independent learner-event stream. */
export interface LearnerScope {
  readonly learnerId: LearnerId
  readonly enrollmentId: EnrollmentId
}

/** Caller-owned event fields before sequence and durable time are assigned. */
export interface LearnerEventDraft<T extends string = string, D extends JsonValue = JsonValue> extends LearnerScope {
  readonly eventId: EventId
  readonly commandId?: CommandId
  readonly sourceSessionId: SessionId
  readonly type: T
  readonly version: number
  readonly data: D
}

/** One immutable, committed event in the Learner Event Store. */
export interface LearnerEventEnvelope<T extends string = string, D extends JsonValue = JsonValue> extends LearnerEventDraft<T, D> {
  readonly seq: number
  readonly time: number
}

export interface LearnerMemoryAppendResult {
  readonly event: LearnerEventEnvelope
  readonly appended: boolean
}

export type LearnerMemoryErrorCode =
  | 'closed'
  | 'corrupt'
  | 'idempotency-conflict'
  | 'identity-mismatch'
  | 'invalid-event'
  | 'sequence-gap'
  | 'unsafe-root'
  | 'unsupported-version'

/** Stable diagnostics for durable learner-memory failures. */
export class LearnerMemoryError extends Error {
  constructor(
    readonly code: LearnerMemoryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'LearnerMemoryError'
  }
}

function snapshotJson(value: unknown, seen = new Set<object>()): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) throw new LearnerMemoryError('invalid-event', 'learner event data contains an invalid JSON number')
    return value
  }
  if (typeof value !== 'object') throw new LearnerMemoryError('invalid-event', 'learner event data is not JSON-serializable')
  if (seen.has(value)) throw new LearnerMemoryError('invalid-event', 'learner event data contains a circular reference')
  seen.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length) throw new LearnerMemoryError('invalid-event', 'learner event data contains a sparse array')
      return Object.freeze(value.map(item => snapshotJson(item, seen))) as unknown as JsonValue[]
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new LearnerMemoryError('invalid-event', 'learner event data contains a non-plain object')
    }
    const result: Record<string, JsonValue> = {}
    for (const [key, nested] of Object.entries(value)) result[key] = snapshotJson(nested, seen)
    return Object.freeze(result)
  } finally {
    seen.delete(value)
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LearnerMemoryError('corrupt', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new LearnerMemoryError('corrupt', `${label}.${key} must be a string`)
  return value
}

function requireInteger(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key]
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new LearnerMemoryError('corrupt', `${label}.${key} must be a non-negative safe integer`)
  }
  return value as number
}

/** Snapshot and validate a caller event before it reaches a Provider. */
export function prepareLearnerEvent<T extends string, D extends JsonValue>(draft: LearnerEventDraft<T, D>): LearnerEventDraft<T, D> {
  const eventId = EventId(draft.eventId)
  const learnerId = LearnerId(draft.learnerId)
  const enrollmentId = EnrollmentId(draft.enrollmentId)
  const sourceSessionId = brand<SessionId>(draft.sourceSessionId, 'source session')
  const commandId = draft.commandId === undefined ? undefined : CommandId(draft.commandId)
  if (!EVENT_TYPE_PATTERN.test(draft.type)) throw new LearnerMemoryError('invalid-event', `learner event type "${draft.type}" is invalid`)
  if (!Number.isSafeInteger(draft.version) || draft.version < 1) throw new LearnerMemoryError('invalid-event', `learner event version must be a positive safe integer, got ${String(draft.version)}`)
  const data = snapshotJson(draft.data) as D
  return Object.freeze({
    eventId,
    ...(commandId === undefined ? {} : { commandId }),
    learnerId,
    enrollmentId,
    sourceSessionId,
    type: draft.type,
    version: draft.version,
    data,
  })
}

/** Parse one persisted envelope without interpreting its learning-domain payload. */
export function parseLearnerEventEnvelope(value: unknown, label = 'learner event'): LearnerEventEnvelope {
  const record = requireRecord(value, label)
  const version = requireInteger(record, 'version', label)
  if (version !== LEARNER_EVENT_VERSION) {
    throw new LearnerMemoryError('unsupported-version', `${label} has unsupported required version ${String(version)}; expected ${String(LEARNER_EVENT_VERSION)}`)
  }
  const type = requireString(record, 'type', label)
  const prepared = prepareLearnerEvent({
    eventId: EventId(requireString(record, 'eventId', label)),
    ...(record.commandId === undefined ? {} : { commandId: CommandId(requireString(record, 'commandId', label)) }),
    learnerId: LearnerId(requireString(record, 'learnerId', label)),
    enrollmentId: EnrollmentId(requireString(record, 'enrollmentId', label)),
    sourceSessionId: brand<SessionId>(requireString(record, 'sourceSessionId', label), 'source session'),
    type,
    version,
    data: snapshotJson(record.data),
  })
  return Object.freeze({
    ...prepared,
    seq: requireInteger(record, 'seq', label),
    time: requireInteger(record, 'time', label),
  })
}

/** Durable append-only learner-memory capability. */
export abstract class LearnerMemory extends Service {
  constructor(ctx: Context) {
    super(ctx, 'learnerMemory')
  }

  /** Read one validated immutable event prefix in ascending seq order. */
  abstract read(scope: LearnerScope): Promise<readonly LearnerEventEnvelope[]>

  /** Append one event durably or return its idempotent prior commit. */
  abstract append(draft: LearnerEventDraft): Promise<LearnerMemoryAppendResult>

  /** Wait for writes admitted before this call to become durable. */
  abstract flush(scope?: LearnerScope): Promise<void>

  /** Resolve a provider-owned local artifact when one exists. */
  abstract locate(scope: LearnerScope): string | undefined
}

export default LearnerMemory
