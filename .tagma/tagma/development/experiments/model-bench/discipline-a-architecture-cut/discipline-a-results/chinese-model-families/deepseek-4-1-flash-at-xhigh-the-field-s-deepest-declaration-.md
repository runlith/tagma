---
id: 01a0c605-2dab-7b63-ba7a-608176fba952
title: "DeepSeek 4.1 Flash at xhigh: the field's deepest declaration moves, a 174-line residual — and the signature defect shipped anyway"
ord: 5
---
DeepSeek 4.1 Flash at xhigh produced the deepest declaration work of the field — three declarations moved into PRE-EXISTING owners, a 174-line residual — and ships the signature defect anyway, plus a self-inflicted formatting accident over 21 unrelated files.

- **Six files, 174-line residual.** `AgentTurnSettlement` (steps array, closed latch, five ending cells), `AgentTurnCall` (one call's fold, buffers, latches), `AgentToolBatch` (prepared calls, per-call completion cells, path edges), `AgentToolInputStream` (partial readers, published titles), `AgentTurnStep` (step flow + the drained-injection cell — self-disclosed as the one thin owner, a composition point rather than a state owner).
- **Declaration moves nobody else made.** `totalAgentUsage` → `AgentStep.ts:49` (a fold over what that file declares), `abortFailure` → `AbortWatch.ts:20`, and the projection pair `AgentModelContext`/`AgentModelContextInput` → `modelPort.ts:28,47` — the vocabulary module. Every other run moved declarations only into NEW files it created; this one rehomed them into existing owners, the strongest reading of law 2 in the field.
- **One upward edge survives, and it is the contract's own.** `AgentTurn.ts:14` still imports `AgentStreamOutput` from `./AgentRunner` — because `AgentTurn.output` is `Omit<AgentStreamOutput,'events'>` (verified, line 62): the type the public contract is made of. SWE-2 high removed even this by moving the type down; DeepSeek xhigh left it standing with a stated reason.
- **The signature defect shipped.** `AgentToolBatch.ts:30` declares `export type AgentToolOutcome = {…}` beside the door's own at `AgentToolDoor.ts:94`. `agentToolSources` stayed, as everywhere but Opus.
- **The formatting accident is real and disclosed.** A `biome format --write` over the whole directory reformatted 22 unintended files (whitespace only — import wrapping, wrapped signatures); the report leads with it, lists per-file line deltas, and reverted what it could (`index.ts` back to the baseline's 65 lines, verified). The deliverable diff carries ~21 files of unrelated churn — noise every judge will have to read past.
- **Gates re-verified in the guest's own container:** `bun run typecheck` exit 0; `bun test` 605 pass / 2 fail — the recorded `shipped.test.ts` baseline.

Inside DeepSeek the ordering is monotonic: xhigh > [[16741b4e|max]] > [[81fb8559|high]] — the only model in the field whose three levels staircase cleanly. Against [[899562bb|SWE-2 high]] it cuts deeper and moves further, but pays with the duplicate outcome and the accident.
