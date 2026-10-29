---
id: 01a0d140-d4e5-7660-946c-323d60a45aeb
title: "Opus 5.5 at high: a 170-line residual, the upward edge gone at last — and both Opus findings lost"
ord: 9
---
Opus 5.5 at high cuts [[4ac015f4|Discipline A]] into five state owners and three modules of moved declarations, leaving a 170-line residual. It is the first Opus row to remove the upward type edge to `AgentRunner.ts`, but it loses both findings every [[001a00cc|Opus 5 high]] and [[f11b6625|xhigh]] run made.

- **The cut.** `AgentTurnLedger` holds the steps, the closed latch and the five deferred faces. `AgentModelCall` holds one call's buffer, fold, first-word flag and projection pair. `StreamingToolInputs` holds one reader and title per open call id. `AgentStepInjection` holds the messages drained once per step, replacing the pin's `{current}` cell. `AgentToolBatch` holds the batch's completion cells and dependency edges. `AgentTurnDeps`, `AgentToolCall` and `AgentStepAssembly` hold no state, and the report says so.
- **The upward edge is gone.** `AgentStreamOutput` moved into the ledger, and the `AgentModelContext` pair moved into `AgentTurnDeps`. `AgentRunner` re-exports all three under their old names. None of the new files imports `./AgentRunner`. This is the move [[899562bb|SWE-2 high]] and the DeepSeek rows made and no Opus 5 run did.
- **The signature defect, shipped.** `AgentToolCall.ts:9` exports a second `AgentToolOutcome` beside `AgentToolDoor.ts:65`, the one `index.ts` publishes. Every Opus 5 run above low renamed the private type.
- **The projection missed.** `agentToolSources` stays in `AgentTurn.ts:158`, called only by `AgentRunner`. [[6e83410a|Opus 5 max]] missed it too.
- **The report matches the tree.** It gives 901 → 170 lines, names each stateless module as stateless, and names the two extra `Effect.gen` hops per call. It counts about 87 comment lines lost. The count reads 141 → 54 across the touched files.
- **A condition earlier rows did not face.** The guest's `write` and `edit` now drop every newly written comment line, under the comment law. That is why the moved blocks lost their comments, and the run declined to get around the filter through the shell. Rows run before this door existed kept their comments. Comment loss therefore does not count against this run.
- **Checked by me in its guest:** `tsc` exit 0, and 605 pass / 2 fail (the two baseline `shipped.test.ts` failures). About 10 minutes from spawn to report.
