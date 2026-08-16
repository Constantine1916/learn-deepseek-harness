# @learn-dsh/teacher

The Learn DSH teacher plugin consumes the public DSH `systemPrompt` Service Definition, registers the stable `learn-dsh:teacher` section, and contributes the exact committed LearnerState through a named dynamic runtime context. DSH persists changes to that context as plugin-source `user/message` snapshots before the corresponding model request.

The package only presents state owned by `ctx.teaching`; it does not own curriculum, persistence, lab execution, tools, or Agent Loop behavior.
