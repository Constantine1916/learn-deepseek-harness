# Headless teaching-loop example

This keyless example boots a real `cordis.yml` through DSH app boot and Cordis Loader, mounts the public Agent Loop spine, sandboxed Lab, teaching state machine, learning tools, JSONL Session persistence, and local Learner Event Store, then drives the first foundations unit with a scripted LLM adapter.

The journey covers first entry, deterministic unit start, explain, checkpoint, isolated exercise creation, a failed machine check, retry of the same attempt, a successful check, evidence-backed unit completion, original Session resume, and a new Session continuing the same Enrollment. Every model request captures the exact `learn-dsh:learner-state` runtime-context section and asserts that the same text exists in the corresponding DSH Session Log.

The example uses temporary workspace and home directories unless `DSH_HOME` is supplied. It does not require a model key and removes its temporary files on exit.

Run it from the repository root with `pnpm example:headless`.
