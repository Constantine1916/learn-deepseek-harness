# @learn-dsh/tool-learning

Registers the Phase 2 `learning_get_state`, `learning_start_unit`, and `learning_complete_activity` tools. The tools are thin model-facing adapters over `ctx.teaching`; they never accept filesystem paths, check commands, mastery levels, or arbitrary next activities.
