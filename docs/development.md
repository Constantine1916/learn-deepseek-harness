# Development

## Naming

- Published packages use the `@learn-dsh/<role>` scope.
- Cordis function-plugin names use `learn-dsh-<role>`.
- Loader row IDs use `learn-dsh-<role>` so profile patches remain readable and stable.
- Model-visible registry names use the `learn-dsh:` prefix, such as `learn-dsh:teacher`.

## Package boundaries

`@learn-dsh/curriculum` owns the runtime course schema, graph validation, immutable read-only Service, packaged content entries, exercise check specs, and DSH source-anchor resolution. `@learn-dsh/learner-memory` owns the `ctx.learnerMemory` Service Definition, durable envelope, corruption diagnostics, and the fsynced local JSONL Provider. `@learn-dsh/learner` owns typed `learning/*` events, pure projection, and the durability-before-success query/append Service. `@learn-dsh/lab` owns the swappable exercise-workspace/check seam and sandboxed local Provider. `@learn-dsh/teaching` owns deterministic diagnosis, planning, Session-to-Enrollment binding, activity transitions, hint sequencing, completion, and reporting. `@learn-dsh/teacher` owns the teacher Persona and exact committed LearnerState runtime context. `@learn-dsh/tool-learning` owns the model-facing learning domain tools. `@learn-dsh/bundle` owns installation metadata and its patch layer; it contains no teaching behavior. `@learn-dsh/example-headless` is a private real-Loader and Agent Loop composition used by the keyless snapshot.

`learning/*` belongs only to the independent Learner Event Store and is never registered as a DSH Session event. DSH Session Logs contain ordinary request/session events plus the exact model-visible LearnerState runtime-context snapshot. The remaining release work is registry publication, real-model/manual teaching evaluation, coverage closure, and an interactive deployment surface.

## Gates

Use Node.js from [the compatibility matrix](compatibility.md), install with `pnpm install`, and run `pnpm check`. The aggregate command runs lint, strict source and test typechecking, unit tests, coverage reporting, the real-Loader keyless snapshot, build, documentation links, DSH compatibility, tracked-file secret scanning, isolated profile install/remove/reinstall, and packed-tarball consumer verification.
