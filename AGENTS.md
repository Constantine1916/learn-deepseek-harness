# AGENTS.md

Learn DeepSeek Harness is an external teaching distribution for DeepSeek Harness. It composes DSH through plugins, presets and a bundle; it does not maintain a fork of the DSH runtime.

## Before changing behavior

1. Read [SPEC.md](SPEC.md) and the active specification.
2. Identify the requirement IDs and acceptance criteria affected by the change.
3. Read the matching DSH architecture and subsystem documentation for every extension point used.
4. Update the specification first when product behavior or an interface changes.

## Architecture rules

- New behavior attaches to documented DSH services or events.
- Do not patch or copy Agent Loop behavior into this repository.
- Depend on Service Definitions rather than concrete Providers.
- Use complete capability seams when a capability is intended to be swappable.
- Keep model-visible learning state reconstructable from durable events and versioned curriculum inputs.
- Keep curriculum selection and completion rules deterministic; use the model for explanation, questioning and feedback.
- Execute exercises only inside resolved attempt workspaces through DSH sandbox, filesystem, subprocess and approval capabilities.
- Reject invalid curriculum, missing sources and unsafe paths at the earliest resolvable point.
- Keep deployment-varying values in validated plugin configuration.

## Tests

- Every behavior change includes focused unit or integration coverage.
- Every product-user-visible teaching change updates a keyless snapshot through a real runnable composition.
- Practice completion requires machine evidence when the skill is mechanically testable.
- Real-model evaluations complement keyless tests; they do not replace deterministic CI.
- Report only commands actually run.

## Documentation

- Keep requirements, design, implementation tasks, tests and acceptance evidence traceable by stable IDs.
- Describe current behavior without review-history narration.
- Keep one authoritative home for each fact and link to it elsewhere.
- Update user documentation and known limitations with the implementation.
