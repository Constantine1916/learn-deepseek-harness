# @learn-dsh/teaching

`ctx.teaching` owns the deterministic diagnostic planner and activity state machine. It binds DSH Sessions to trusted Learner/Enrollment scopes, reads only committed learner state, calls the abstract `ctx.lab` seam for attempt work, and persists every state change before returning success.

The Phase 2 state machine is `explain → checkpoint → exercise → feedback`, with failed or blocked feedback returning to the same exercise attempt and passed machine evidence allowing unit completion.

Phase 3 builds diagnostic candidates from the selected curriculum path's objectives and required rubric. A unit is waiver-eligible only when every required rubric has matching `meets` evidence and at least one item is `observed` or `machine`. Eligibility never mutates progress by itself: only an explicit learner-requested command can append `learning/unit-waived`, which remains distinct from exercise completion.
