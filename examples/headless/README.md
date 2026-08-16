# Headless prompt example

This keyless example boots a real `cordis.yml` through the DSH app boot and Cordis Loader, verifies curriculum anchors, commits four learner events through the local Provider, flushes and replays LearnerState, assembles `ctx.systemPrompt`, prints the deterministic result, and exits cleanly. When `DSH_HOME` is absent it uses and removes a temporary home.

The LearnerState shown here is the long-term committed state. Recording the exact state supplied to an actual model request in the DSH Session Log is a Phase 2 integration and is not claimed by this example.

Run it from the repository root with `pnpm example:headless`.
