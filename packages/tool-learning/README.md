# @learn-dsh/tool-learning

Registers model-facing tools for committed state, curriculum-derived diagnosis, explicit evidence-backed unit waiver, learner-requested plan adjustment, unit start, and activity completion. The tools are thin adapters over `ctx.teaching`; they never accept check commands, mastery levels, or arbitrary next activities.

Observed diagnostic evidence can only cite an exact source path and anchor returned from the validated curriculum. `learning_waive_unit` rechecks every required rubric and requires a learner reason; diagnostic eligibility alone never marks a unit completed or waived.
