# Compatibility

The current implementation supports exactly DeepSeek Harness `0.1.2-rc.1` on Node.js `^22.19.0 || >=24.0.0`. The machine-readable authority is [`compatibility.json`](../compatibility.json).

All DSH runtime packages resolve from the npm registry at exact version `0.1.2-rc.1`. The supported source baseline is tag `dsh-v0.1.2-rc.1`, commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`. That read-only checkout supplies versioned curriculum documents and source anchors only; it is never a runtime dependency or build prerequisite.

Run `pnpm compat` to verify the registry-installed DSH version, every declared DSH package version, the source checkout commit, and the current Node runtime. Set `DSH_CHECKOUT=/absolute/path/to/deepseek-harness` when the source checkout is not adjacent.

CI runs the aggregate release gates on Linux with Node 22.19 and Node 24, plus macOS with Node 22.19. Because the supported DSH range contains one exact prerelease, the minimum and maximum are both `0.1.2-rc.1`. Every job installs the runtime from the registry and checks out the same source commit only for curriculum-anchor verification.

`pnpm release:check` packs all eight public Learn DSH packages, installs them from tarballs in a temporary consumer beside registry DSH, rejects `link:` and `workspace:` protocols or mixed DSH versions, imports every public entry, and repeats the profile lifecycle and keyless teaching journey. See [release checks](release.md) for the publication boundary.

DSH `0.1.2-rc.1` still exposes no public registration surface for required out-of-repo Session events. Learn DSH therefore keeps long-term `learning/*` events in its own versioned Learner Event Store and uses the DSH Session Log only for per-session conversation and exact model-visible state snapshots.
