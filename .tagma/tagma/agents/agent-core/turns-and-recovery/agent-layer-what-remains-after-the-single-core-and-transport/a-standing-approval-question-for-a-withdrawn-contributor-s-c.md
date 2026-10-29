---
id: 01a151e9-674e-7bdb-8965-3d9c3749f744
title: A standing approval question for a withdrawn contributor's call closes with a typed outcome instead of waiting for an answer
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fc-a66e-7da5-9aab-de440eab265c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: packages/agent/src/thread/run/hostedAsks.ts
  - kind: file
    ref: packages/agent/src/thread/run/ParkedQuestions.ts
---
A tool source is revoked by disposal of its registration (`packages/agent/src/registry/Registry.ts`): that is how a plugin on process restart or shutdown withdraws its capability and source (`native-harness/agents/declared/plugins.ts`). A tool knows only the `standing` predicate, and a call standing on an approval question waits on `callStops` or the question deadline (`thread/run/ParkedQuestions.ts`, on the hosted road `thread/run/hostedAsks.ts`); withdrawing the registration gives no such signal. The `contributor-absent` check fires only after the answer, at execution (`agent/door/ToolExecution.ts:463`). A question with deadline `none` holds the run in `awaiting` until the operator answers a question whose outcome is already known: a refusal.

Do: disposal of the contributor closes standing questions of its tools' calls with a typed `contributor-absent` outcome, and the run moves on; re-registering the same id does not revive the old question.

Proof: `ContributorWithdrawal.itest.ts` — 2 pass, 0 fail, 14 assertions. Native passes `awaiting-question` → withdrawal and re-registration of the source → automatic continuation → `idle`; hosted passes waiting → `running`, the repeated call returns the earlier `output-refused`/`contributor-absent`. The tool is not executed in either case. The affected existing suites and package typecheck (799 files) passed. A confirmed P2 review finding now stores the withdrawal outcome in `ThreadQuestionEntry.outcome`: a separate red→green owner replay checks the repeat after the waiter is gone, before the terminal call record. Owner/wire suites — 14 pass, 56 assertions; withdrawal-integration repeat — 2 pass. No live restart or shutdown of a plugin process was run; disposal wiring is traced to `native-harness/agents/declared/plugins.ts:54–58`.
