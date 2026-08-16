# Development

## Naming

- Published packages use the `@learn-dsh/<role>` scope.
- Cordis function-plugin names use `learn-dsh-<role>`.
- Loader row IDs use `learn-dsh-<role>` so profile patches remain readable and stable.
- Model-visible registry names use the `learn-dsh:` prefix, such as `learn-dsh:teacher`.

## Package boundaries

`@learn-dsh/teacher` owns the teacher system-prompt contribution and depends only on the public `systemPrompt` Service Definition. `@learn-dsh/bundle` owns installation metadata and its patch layer; it contains no teaching behavior. `@learn-dsh/example-headless` is a private runnable composition used by the keyless snapshot.

Future curriculum, learner state, diagnostics, labs, tools, presets, and UI packages are not part of Phase 0.

## Gates

Use Node.js from [the compatibility matrix](compatibility.md), install with `pnpm install`, and run `pnpm check`. The aggregate command runs lint, strict source and test typechecking, unit tests, the real-Loader keyless snapshot, build, documentation links, DSH compatibility, and an isolated profile install/dump/remove check.
