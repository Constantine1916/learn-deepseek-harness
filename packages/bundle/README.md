# @learn-dsh/bundle

Installable DSH bundle for Learn DeepSeek Harness. Its patch inserts curriculum, local learner-memory, learner projection/query, and teacher plugins without modifying the DSH Runtime or Agent Loop. Learner memory is rooted under `DSH_HOME/learn-dsh/learner-memory`; curriculum source resolution remains deployment-configurable.

During Phase 0 the supported DSH release is consumed from the adjacent checkout documented in [compatibility](../../docs/compatibility.md). Registry installation is deferred until the matching DSH packages are published.
