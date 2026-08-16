# @learn-dsh/bundle

Installable DSH bundle for Learn DeepSeek Harness. Its patch inserts curriculum, local learner-memory, learner projection/query, sandboxed lab, deterministic teaching, teacher-context, and learning-tool plugins without modifying the DSH Runtime or Agent Loop. Learner memory is rooted under `DSH_HOME/learn-dsh/learner-memory`; curriculum source resolution and exercise workspace placement remain deployment-configurable.

The supported DSH release is consumed from the adjacent checkout documented in the repository's [compatibility guide](https://github.com/Constantine1916/learn-deepseek-harness/blob/main/docs/compatibility.md). Registry installation is deferred until the matching DSH packages are published. The patch assumes its host profile already provides the DSH Agent/System Prompt/Tools and sandboxed FS/Shell capability stack.
