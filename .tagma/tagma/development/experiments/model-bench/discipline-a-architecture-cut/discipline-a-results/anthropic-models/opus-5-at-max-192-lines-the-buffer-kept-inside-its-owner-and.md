---
id: 01a0c4f7-9240-7751-98be-aad66e83410a
title: "Opus 5 at max: 192 lines, the buffer kept inside its owner, and the one finding it let go"
ord: 3
---
Opus 5 at max leaves 192 lines — the smallest honest residual of the field — over five owners, and is the only Opus row above low that missed the misplaced projection.

- **The five.** `AgentTurnRecord` holds the steps, the five faces and the closed latch; `AgentCallAttempt` one call's fold and framing; `ToolInputDisplay` a reader and a title per open call; `AgentToolBatch` the prepared calls and their completion cells; `StepInjection` the once-drained messages of a step. The shape [[f11b6625|the xhigh runs]] reached, fourteen lines tighter.
- **The buffer never leaves its owner.** The attempt answers `flush`, an Effect over its own array, so the step decides when framing is shown and never walks it: three loops in the pin become three `yield* call.flush`.
- **The steps keep their identity.** `steps: () => steps` hands back the live list, so `stopWhen` and `completedSteps()` read what they always read, and `finish` reads its own list instead of taking it as an argument — where [[001a00cc|high]] passes the array in.
- **The collision found, the projection missed.** The private outcome type ships as `AgentCallOutcome`, so nothing shadows the door's `AgentToolOutcome`; but `agentToolSources` stayed in the residual, where xhigh and high both moved it to `ToolCatalog`.
- **Verified.** The path law, `assembleStep` and the attempt body diff clean against `b1f8e9da5`; `previous` is captured where nothing changes it between the two attempts. `tsc` exit 0, 605 pass / 2 fail, re-run by me. 18 minutes, 88k written tokens.
