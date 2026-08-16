# @learn-dsh/teaching

`ctx.teaching` owns the deterministic Phase 2 planner and activity state machine. It binds DSH Sessions to trusted Learner/Enrollment scopes, reads only committed learner state, calls the abstract `ctx.lab` seam for attempt work, and persists every state change before returning success.

The Phase 2 state machine is `explain → checkpoint → exercise → feedback`, with failed or blocked feedback returning to the same exercise attempt and passed machine evidence allowing unit completion.
