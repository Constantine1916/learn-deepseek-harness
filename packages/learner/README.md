# @learn-dsh/learner

Typed `learning/*` domain events, deterministic LearnerState projection, and the `ctx.learner` query/append Service. The Service validates a proposed transition against the current durable prefix, appends through `ctx.learnerMemory`, waits for durability, then returns the replayed committed state.

Learning events are not DSH Session events. A single EnrollmentId can be queried from multiple Sessions through their shared LearnerId/EnrollmentId scope; different scopes never share a prefix. Replaying the same EventId is idempotent.

This package does not inject model context. `@learn-dsh/teacher` renders the committed state owned by `ctx.teaching`; the public DSH Agent Loop records changed runtime-context snapshots in the corresponding Session Log.
