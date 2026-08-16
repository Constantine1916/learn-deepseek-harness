# Headless prompt example

This keyless example boots a real `cordis.yml` through the DSH app boot and Cordis Loader, loads the external Learn DSH curriculum and teacher plugins, verifies packaged source anchors against the locked adjacent DSH checkout, assembles `ctx.systemPrompt`, prints the prompt plus curriculum snapshot, and exits cleanly.

Run it from the repository root with `pnpm example:headless`.
