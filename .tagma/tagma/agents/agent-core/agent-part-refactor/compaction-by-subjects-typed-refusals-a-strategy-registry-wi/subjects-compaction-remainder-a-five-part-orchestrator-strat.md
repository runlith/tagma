---
id: 01a11c57-49a7-74c9-a5c2-1038acf0fe9c
title: "Subjects compaction remainder: a five-part orchestrator, strategies with off, step cost, typed refusal at the door"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-912bcf62d829
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd8b0203ef2
---
What did not fit into cf62d829 (landed 7614173e18, dbc3a3afac) and remains the criteria of [[b0203ef2]]:

- **Splitting `ThreadCompaction.ts`.** The file is still ~1017 lines without imports (debt 175758d8); `policy`/`meter`/`pruner`/`router`/`settlement` are not extracted, and the orchestrator is still assembled by the old options bag.
- **Strategy registry and `off`.** Strategies are fixed at kernel build; neither the definition nor the mode can select a strategy or switch compaction off. There is no test where the “off strategy passes a long run and refuses with a typed overflow refusal”.
- **Automatic path.** No rule “continue the turn without compaction only when the owner has proven the request fits; otherwise a typed refusal visible in `RunStatus` and activity”.
- **Typed refusal at the Tagma door** is done (a9387d11ed): `ThreadSummaryFailedError` is served with the `summary-failed` code in `threads/refusals.ts` and in `compact_thread` refusals.
- **Prune marks** are still written before the settlement transaction (`ThreadCompaction.ts` `pruned`). Needed: `markToolCallsPrunedIn(tx)` in both adapters' ports (`storage/memory/ThreadCompaction.ts`, `native-harness/compaction/store.ts`), new prune marks in `ThreadCompactionSettlement` and `settleIn`, and rewritten “fast path” itests in `ThreadCompaction.itest.ts` (they read the marks right after `prepare`).
- **Step cost.** No `prepare`/meter budget test on a long tail; a cold meter still hashes the whole history on the event loop.
- Calibration: version and key prefixes removed, persistence asynchronous, driver an interval of 30 s plus the host finalizer (`native-harness/kernel.ts`). There is no kernel-level test “observations are saved after host shutdown”; it exists at the `ThreadTokenCalibration.persist` and store level.
