# @learn-dsh/teaching

`ctx.teaching` owns the deterministic diagnostic planner and activity state machine. It binds DSH Sessions to trusted Learner/Enrollment scopes, reads only committed learner state, calls the abstract `ctx.lab` seam for attempt work, and persists every state change before returning success.

The Phase 2 state machine is `explain → checkpoint → exercise → feedback`, with failed or blocked feedback returning to the same exercise attempt and passed machine evidence allowing unit completion.

Phase 3 builds diagnostic candidates from the selected curriculum path's objectives and required rubric. Diagnosis affects recommendations and misconceptions, but it never blocks an explicit learner-requested `learning/unit-skipped`. Skipped units satisfy navigation prerequisites while remaining distinct from mastery and exercise completion.

Phase 4 persists strictly sequential hint levels before returning their text, resolves unit misconceptions only after authored and machine evidence, completes the course idempotently only when every unit is completed, and generates a deterministic report that separates read/started, user-skipped, exercise-completed, and comprehensive-validated outcomes.
