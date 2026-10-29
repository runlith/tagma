---
id: 01a0c5ff-14b2-7a8a-99c9-fb9781fb8559
title: "DeepSeek 4.1 Flash at high: seven owners under a 310-line residual, both field defects shipped"
ord: 4
---
DeepSeek 4.1 Flash at high cut the 901-line `AgentTurn.ts` into a 310-line residual plus seven modules, and ships BOTH of the field's signature defects that its own max run avoided half of — the duplicate `AgentToolOutcome` AND the standing upward edge to `AgentRunner`.

- **Seven owners, two of them stateless.** `AgentModelCall` (per-attempt fold, buffers, first-word latch), `ToolCallExecution` (completion Deferreds, dependency edges, per-call outcomes), `ToolInputStream` (partial readers, last-published titles), `AgentStepInjection` (once-per-step drained messages + retry latch) hold state; `AgentStepAssembly` is pure (the step-record fold — and the home of the second `AgentToolOutcome` declaration); `ToolCallPaths` is a policy owner (path-overlap containment), `ToolCallPreparation` a per-call reading. The residual keeps the ledger, the five ending deferreds, the closed latch and the loop — the state that IS the turn — and `step()`.
- **The upward edge stands.** `AgentTurn.ts` and `AgentModelCall.ts` still import `AgentModelContext`/`AgentModelContextInput`/`AgentStreamOutput` from `./AgentRunner` — the move-down the max run made and this run did not. `AgentRunner.ts` untouched at 271 lines.
- **The signature defect shipped.** `AgentStepAssembly.ts:8` declares `export type AgentToolOutcome = {…}` beside the door's own at `AgentToolDoor.ts:65` — the collision eight runs exported and no Opus row did. `agentToolSources` stayed, as everywhere but Opus.
- **Report honesty is the strong side.** It names its own deviations without prompting: two stateless owners admitted in the state table, the 310-line residual named as unfinished ("about 110 of them the `step()` method"), no independent oracle admitted, and every claimed size matches the diff (310/287/175/83/81/81/60/55 = 1132 over eight files). The trace-payload rename `request`→`payload` is disclosed.
- **Gates re-verified in the guest's own container**, not the report: `bun run typecheck` exit 0; `bun test` 605 pass / 2 fail — exactly the recorded `shipped.test.ts` baseline reds.

Against [[16741b4e|its own max run]]: the max run kept the smaller residual, moved declarations down to kill the upward edge, and still shipped the duplicate outcome — high does less and defects more. The level ordering inside DeepSeek runs the same direction as inside SWE-2's field standing but inverted in outcome: here high is strictly worse.
