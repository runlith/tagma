---
id: 01a0d14b-7ba9-7294-9c54-ccc72809e91e
title: "Opus 5.5 at xhigh: the upward edge cleared and the collision renamed together, over coarser owners — the projection missed"
ord: 10
---
Opus 5.5 at xhigh cuts [[4ac015f4|Discipline A]] into four state owners and one input contract under a 182-line residual. It is the only row of the field that both clears the upward type edge to `AgentRunner.ts` and keeps the second `AgentToolOutcome` from being born. It pays for that with coarser owners than [[f11b6625|Opus 5 xhigh]], and it misses the projection.

- **The cut.** `TurnLedger` holds the steps, the closed latch and the five deferred faces, and also folds a step (`assembleStep`). `ModelStep` holds one step's injection cell and one attempt's signal, buffer, fold and first-word timing. `StreamingToolInputs` holds a reader and title per open call. `ToolBatch` holds the prepared calls and each batch's completion cells and edges. `AgentTurnDeps` holds no state, and the report says so.
- **Coarser than the other Opus rows.** The injection latch stays inside the model call, where [[60a45aeb|Opus 5.5 high]] and every Opus 5 row above low gave it an owner of its own. `ModelStep` (222 lines) and `ToolBatch` (276) are the two largest owners in any Opus row.
- **The edge is gone and the collision is avoided, together.** `AgentStreamOutput` moved into `AgentTurn.ts`, and the `AgentModelContext` pair moved into `AgentTurnDeps.ts`. `AgentRunner` re-exports all three, and no turn file names `AgentRunner`. The private outcome ships as `ToolCallOutcome` (`ToolBatch.ts:9`), so `AgentToolDoor.ts:65` stays the only `AgentToolOutcome`. [[899562bb|SWE-2 high]] is the only other row to do both, under a 224-line residual.
- **The projection missed.** `agentToolSources` stays at `AgentTurn.ts:164`, called only by `AgentRunner`, as in [[60a45aeb|its high run]] and [[6e83410a|Opus 5 max]].
- **Findings nobody asked for.** It names `ToolCallOutcome.input` and `.refused` as written and never read, and leaves them standing because this is the shape step. It also names the now partly stale header comment it could not rewrite.
- **The report matches the tree.** Its line counts, import order and "no file of the turn imports AgentRunner" all read true. It counts 76 + 9 comment lines lost; the touched files hold 56 comment lines where the pin held 141.
- **The same comment filter as [[60a45aeb|its high run]]:** the guest's `write` and `edit` drop new comment lines. It declined to get around them, and the loss does not count against the run.
- **Checked by me in its guest:** `tsc` exit 0, and 605 pass / 2 fail (the two `shipped.test.ts` baseline failures). About 22 minutes from spawn to report, roughly twice its high run.
