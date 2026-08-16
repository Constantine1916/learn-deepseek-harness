# Development

## Naming

- Published packages use the `@learn-dsh/<role>` scope.
- Cordis function-plugin names use `learn-dsh-<role>`.
- Loader row IDs use `learn-dsh-<role>` so profile patches remain readable and stable.
- Model-visible registry names use the `learn-dsh:` prefix, such as `learn-dsh:teacher`.

## Package boundaries

`@learn-dsh/curriculum` owns the runtime course schema, graph validation, immutable read-only Service, packaged content entries, and DSH source-anchor resolution. `@learn-dsh/learner-memory` owns the `ctx.learnerMemory` Service Definition, durable envelope, corruption diagnostics, and the fsynced local JSONL Provider. `@learn-dsh/learner` owns typed `learning/*` events, pure projection, and the durability-before-success query/append Service. `@learn-dsh/teacher` owns the teacher system-prompt contribution. `@learn-dsh/bundle` owns installation metadata and its patch layer; it contains no teaching behavior. `@learn-dsh/example-headless` is a private real-Loader composition used by the keyless snapshot.

`learning/*` belongs only to the independent Learner Event Store and is never registered as a DSH Session event. Diagnostics, labs, tools, presets, UI, and the Phase 2 model-request LearnerState snapshot are not implemented yet.

## Gates

Use Node.js from [the compatibility matrix](compatibility.md), install with `pnpm install`, and run `pnpm check`. The aggregate command runs lint, strict source and test typechecking, unit tests, the real-Loader keyless snapshot, build, documentation links, DSH compatibility, and an isolated profile install/dump/remove check.
