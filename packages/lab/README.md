# @learn-dsh/lab

`ctx.lab` is the swappable exercise-workspace and deterministic-check Service Definition. The `./local` Provider resolves every path through DSH `ctx.fs`, executes only versioned `runner: node` checks through sandboxed `ctx.shell`, and validates an identity marker before reset.

The model never supplies a path or command. A host supplies a trusted Session, Learner scope, loaded curriculum exercise, and stable ExerciseAttemptId.

The bundled fixtures cover lifecycle tracing, a minimal Service Provider, a model-callable Tool, and a comprehensive Provider + Tool bundle. Results distinguish implementation failures from configuration, environment, and safety blocks; blocked checks can be retried on the same attempt.
