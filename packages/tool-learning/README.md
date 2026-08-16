# @learn-dsh/tool-learning

Registers model-facing tools for committed state, curriculum-derived diagnosis, learner-controlled unit skipping, learner-requested plan adjustment, unit start, and activity completion. The tools are thin adapters over `ctx.teaching`; they never accept check commands, mastery levels, or arbitrary next activities.

Observed diagnostic evidence can only cite an exact source path and anchor returned from the validated curriculum. `learning_skip_unit` requires an explicit learner request but no mastery evidence; it records `skipped`, never `completed` or `mastered`.

`learning_request_hint` returns only the next persisted level for the active attempt. `learning_get_report` reads committed state and clearly separates browsing/started work, user-skipped units, exercise completion, and comprehensive integration validation.
