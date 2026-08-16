# @learn-dsh/teacher

The Phase 0 Learn DSH teacher plugin. It consumes the public DSH `systemPrompt` Service Definition and registers the `learn-dsh:teacher` section. The registration is a Cordis effect and is removed when the plugin fiber unloads.

The package intentionally owns no course, learner-state, diagnostic, lab, tool, or Agent Loop behavior.
