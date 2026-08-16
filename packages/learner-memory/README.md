# @learn-dsh/learner-memory

Durable append-only Learner Event Store capability for Learn DSH. Consumers depend on the `ctx.learnerMemory` Service Definition; the `./local` Provider stores one fsynced JSONL log per LearnerId/EnrollmentId scope under an explicitly configured root.

`append()` resolves only after the event line is durable. Stable EventId or CommandId values make retries idempotent. The required payload version is 2. Reads reject malformed JSON, torn records, identity mismatches, duplicate identities, non-monotonic sequence numbers, and unsupported event versions instead of returning an empty history.

The package writes no DSH Session events and contributes no model-facing text. Model-request LearnerState snapshots are owned by `@learn-dsh/teacher` and DSH runtime-context persistence.

The local Provider is single-host-process storage. It serializes concurrent Sessions inside one process, but separate processes must not write the same root concurrently; a team or multi-process deployment requires a later remote Provider.
