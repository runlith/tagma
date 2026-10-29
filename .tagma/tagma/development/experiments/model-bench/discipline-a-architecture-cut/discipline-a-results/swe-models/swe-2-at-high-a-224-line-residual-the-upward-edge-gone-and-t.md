---
id: 01a0c5eb-cb11-770c-9d5b-8b3d899562bb
title: "SWE-2 at high: a 224-line residual, the upward edge gone, and the second outcome never born"
ord: 1
---
SWE-2 at high cut the 901-line `AgentTurn.ts` into a 224-line shell plus four owner modules, ran in sandbox `01a0c5d0-2523-794c-9d53-a4ab0193332d` on prepared tree `01a0c5cd` (snapshotDigest identical to the original field's). Gates re-run by the orchestrator in the guest's own container, not taken from the report: `bun run typecheck` exit 0, `bun test` 605 pass / 2 fail — the recorded baseline exactly.

- **Four owners, each holding real state.** `AgentTurnLedger` (steps array, five Deferred endings, closed flag), `AgentModelCall` (per-call fold, buffers, stall race), `AgentStepCalls` (prepared call set, per-call Deferreds, path-overlap edges), `StreamingToolInputs` (the Map of partial readers and last-published titles). The residual keeps the run loop and step cursor — the state that IS the turn.
- **The top-tier move is present.** The pre-existing upward edge `AgentTurn → AgentRunner` was removed by moving declarations DOWN: `AgentStreamOutput` into `AgentTurn.ts`, the projection pair `AgentModelContext`/`AgentModelContextInput` into `AgentModelCall.ts`; `AgentRunner` re-exports all three, every importer compiles unchanged.
- **The field's signature defect is absent.** Exactly one `AgentToolOutcome` export stands (the door's): the module-private outcome type was renamed `AgentStepCallOutcome` — the rename no Opus row shipped and eight other runs did.
- **Scope is exactly six files**: the four new owners, the residual, and `AgentRunner.ts` for re-exports. Nothing else newer than the snapshot. Report matches the diff on every claim checked: sizes 224/331/384/117/86, the kept-contract claim verified against the files.
- **Honest notes in the report name their own subtleties**: the `previousCallUsage` key-presence semantics preserved by keying on `previousStep`; `StreamingToolInputs.note` invoked per event with the guard moved inside — order identical.

Not ranked here: placement is the blind judges'. Read beside [[f4f690e4|the field's other readings]] and the verdict of [[683dcc1f|the three cuts]].
