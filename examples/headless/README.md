# Headless teaching-loop example

This keyless example loads the registry-published DSH `base + headless` profile through DSH app boot and Cordis Loader, then applies a small overlay that disables the one-shot runner, production model adapter, and automatic session-title model while mounting the sandboxed Lab, teaching state machine, learning tools, JSONL Session persistence, and local Learner Event Store. It drives the complete foundations course with a scripted LLM adapter and never copies or patches the Agent Loop.

The journey covers curriculum-derived novice diagnosis, an experienced learner's explicit skip despite an uncertain rubric, four continuous units, three progressive hints, isolated Provider/Tool/Bundle exercises, implementation failure, environment-blocked retry on the same attempt, machine-backed completion, comprehensive validation, learning report, original Session resume, and a new Session continuing the same Enrollment. Every model request captures the exact `learn-dsh:learner-state` runtime-context section and asserts that the same text exists in the corresponding DSH Session Log.

The example uses temporary workspace and home directories unless `DSH_HOME` is supplied. It does not require a model key and removes its temporary files on exit.

Run it from the repository root with `pnpm example:headless`.
