# @learn-dsh/bundle

Installable DSH bundle for Learn DeepSeek Harness. Its host patch inserts curriculum, local learner-memory, learner projection/query, sandboxed lab, and deterministic teaching without modifying the DSH Runtime or Agent Loop. The packaged `learn-dsh` agent preset owns the teacher Persona, learning tools, and the agent-side file/Shell tools needed during practice, so other presets in the same profile do not inherit the teaching surface.

From the source workspace, run `pnpm build && pnpm preset:install`. The published CLI is `learn-dsh-setup install`; it also supports `check`, `remove`, and `path`, plus `--home <path>`. Installation is idempotent, refuses an unowned preset directory, and removes only a marker-owned directory with no extra files.

Learner memory is rooted under `DSH_HOME/learn-dsh/learner-memory`; curriculum source resolution and exercise workspace placement remain deployment-configurable.

The supported DSH release is consumed from the adjacent checkout documented in the repository's [compatibility guide](https://github.com/Constantine1916/learn-deepseek-harness/blob/main/docs/compatibility.md). Registry installation is deferred until the matching DSH packages are published. The patch assumes its host profile already provides the DSH Agent/System Prompt/Tools and sandboxed FS/Shell capability stack.
