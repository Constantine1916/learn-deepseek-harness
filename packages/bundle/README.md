# @learn-dsh/bundle

Installable DSH bundle for Learn DeepSeek Harness. Its manifest declares `dsh.bundle.patch`, and the patch inserts `@learn-dsh/curriculum` plus `@learn-dsh/teacher` without modifying the DSH Runtime or Agent Loop. The curriculum row loads packaged, schema-validated data without assuming a host checkout path; deployments provide a source root when source resolution is needed.

During Phase 0 the supported DSH release is consumed from the adjacent checkout documented in [compatibility](../../docs/compatibility.md). Registry installation is deferred until the matching DSH packages are published.
