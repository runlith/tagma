---
id: 01a0c5eb-cb19-74c5-98d5-b84d2dc29068
title: "SWE-2 at max: the deepest cut of the field — six owners, a 165-line residual — shipping the signature defect and the standing upward edge"
ord: 2
---
SWE-2 at max cut the 901-line `AgentTurn.ts` deepest of the field — a 165-line residual plus SIX owner modules — ran in sandbox `01a0c5cf-76fb-74ea-999b-b86981cbad27` on prepared tree `01a0c5cd` (snapshotDigest identical to the original field's). Gates re-run by the orchestrator in the guest's own container: `bun run typecheck` exit 0, `bun test` 605 pass / 2 fail — the recorded baseline exactly.

- **Six owners, each with state of its own.** `AgentTurnLedger` (steps, five Deferreds, closed), `AgentStepInjection` (the guidance queue and the once-per-step `injected` slot), `AgentToolInputStream` (per-attempt partial-reader map), `AgentToolDispatch` (batch completion Deferreds and path-overlap edges), `AgentCallAttempt` (one call's buffers, fold and stall race), `AgentStepRun` (the per-step slot and stop-condition walk). The residual keeps only the loop cursor and the wiring.
- **The field's signature defect is PRESENT.** `AgentToolDispatch.ts:28` exports a second `AgentToolOutcome` beside the door's own (`AgentToolDoor.ts:65`) — the collision eight earlier runs shipped and no Opus row did. The report lists it as an export without naming the collision.
- **The upward edge stands.** `AgentTurn`, `AgentCallAttempt`, `AgentStepRun` and `AgentTurnLedger` still `import type` from `./AgentRunner` (`AgentModelContext`, `AgentModelContextInput`, `AgentStreamOutput`). The report argues the exclusion — type-only, erased at runtime, no value cycle — rather than moving the declarations down as the top rows did.
- **Report inflation, small but real.** The residual is described as "a ~70-line composition root"; the file measures 165 lines (the composition root portion within it may be ~70). Placement judges decide what that costs.
- **Scope**: six new modules + `AgentTurn.ts`; `AgentRunner.ts` untouched this time — the moved-declaration move it never made.

Not ranked here: placement is the blind judges'. Read beside [[f4f690e4|the field's other readings]] and the verdict of [[683dcc1f|the three cuts]] — this run ships the deepest decomposition AND the defect the top of the field avoided.
