# Compatibility

The current implementation supports exactly DeepSeek Harness `0.1.0-rc.5` on Node.js `^22.19.0 || >=24.0.0`. The machine-readable authority is [`compatibility.json`](../compatibility.json).

The supported DSH source baseline is commit `0cf6f648c80de1b0572057cd746a20863e39d606`. Because the `0.1.0-rc.5` DSH packages are not available from npm, development resolves DSH packages from an adjacent `../deepseek-harness` checkout through local `link:` dependencies. This keeps the Learn DSH repository external and leaves the upstream checkout unchanged.

Run `pnpm compat` to verify the checkout version and current Node runtime. Set `DSH_CHECKOUT=/absolute/path/to/deepseek-harness` when the checkout is not adjacent.

CI runs the aggregate release gates on Linux with Node 22.19 and Node 24, plus macOS with Node 22.19. Because the supported DSH range currently contains one exact prerelease, the minimum and maximum DSH version are both `0.1.0-rc.5`; every job checks out the same locked commit.

The first published Learn DSH bundle must replace development links with published DSH packages at the same tested version or update the specification and compatibility matrix before widening support.

Before registry publication, `pnpm release:check` provides a local tarball consumer test while keeping DSH peers on this locked checkout. See [release checks](release.md) for the exact boundary.

DSH `0.1.0-rc.6` npm artifacts were inspected during Phase 1 but are not in the support matrix. They still generate the persistence event vocabulary inside DSH and expose no public registration surface for required out-of-repo Session events. Learn DSH therefore keeps long-term `learning/*` events in its own versioned Learner Event Store and uses the DSH Session Log only for per-session conversation and model-visible state snapshots; upgrading only those packages would not change this storage decision and would mix an untested package set with the `rc.5` source baseline.
