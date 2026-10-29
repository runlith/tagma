---
id: 01a14702-7e09-71fb-ae98-c5936f5b4b73
title: "Fork birth builds neither the child's FTS nor rollout in the answer: both projections catch up after commit, outside the writer and the event loop"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a146a4-8f34-7d39-a6df-4e6816c7a2b0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a146a4-3507-7e7d-a582-a7db1020c14d
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/rows/branch.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/conversationIndex.ts
---
After [[1020c14d]] (commit `098f9378f2`) forking a synthetic thread of 8.7k records / 29 MB costs 81 requests and 4.2–13.1 s on a loaded machine. Its finish names the two remaining costs:

- **Child FTS under the writer.** In the calmest run 3.1 s of 4.2 s is inserting the child's messages into `thread_message_fts` inside the birth write-unit; a `messageTerms` worker refusal refuses the fork. The child's conversation index is a projection that `conversationBackfill` can already catch up through `thread_conversation.through`: birth does not have to build it.
- **Child rollout export in the answer and on the event loop.** `EngineBirths.ready` → `ensure` → `exportThreadRollout` reads the whole child journal and serializes it on the loop (rule 7a910861); only the write goes in chunks, and the answer waits for it.

Do: fork birth writes in the writer only what makes the child a thread (rows, events, fold, history, cursors), answers and opens; the conversation index and the child FTS catch up after commit in chunks, never holding the writer longer than one chunk; the child rollout is built outside the answer and outside the event loop, with the [[2b40d171]] invariant and the rollout's writer catch-up intact. Search over the child's replicas tolerates a delay until catch-up ends — the source's replicas stay searchable all along.

Proof: `bench-thread-fork.ts` before/after (answer time and writer hold time); a contract test — a replica of the born fork is found by `search_threads` after catch-up; the existing fork, rollout, and conversation-index sets are green; `bun run typecheck`.

Result (commit `684da89db0`, device — in [[8fdaec3a]]). Measured with `bench-thread-fork.ts --turns=870 --told=85`, two runs before and after on a loaded machine; source 8 785 events / 29 MB / 1 740 messages:
- fork answer: 6.05–6.36 s → 0.56–1.02 s;
- writer in the answer (one write-unit): 5.6–5.95 s → 0.49–0.91 s, of which 4.8 s before was the FTS insert;
- after the answer: 30 write-units, longest 70–168 ms; index and rollout ready 2.0–3.0 s after the call;
- the child rewrite and rollout size (31 793 371 bytes) match byte for byte.

Accepted in review and fixed:
- the lane slot did not reserve the queue — the export enters the lane synchronously (`startImmediately`);
- a failed or broken export did not recover — `ThreadRollouts.owed` on first lane entry;
- the export fork ran before readiness steps that can drop the branch — now it runs last;
- `.partial` survived a failure — removed;
- backfill read the whole conversation at once — pages of 256 for a thread in SQL;
- a removed thread failed the backfill batch — `markOf` answers "no thread";
- the branch mark was set before commit — `afterCommit`.

Not proven / open:
- `journal.open` outside the lane (harness-thread transitions, merge-notice) on a branch before export ends will refuse — so hosted branches export in the answer, and merge-notice is unprotected in the first seconds of a native branch's life;
- removing a branch between the export-cursor write and the rename leaves an orphan file (window — one rename);
- a branch without a file that nobody touches stays without a rollout until the first entry into its journal: no separate pass exists;
- event-loop blocking was not measured; it is bounded by construction with pages (128 export events, 256 backfill events);
- in `parity.stest.ts` 19 devin tests and "after the server restarts" fail on the CLI devin `auth_required` — environment, not the fork; native and other transports are green.
