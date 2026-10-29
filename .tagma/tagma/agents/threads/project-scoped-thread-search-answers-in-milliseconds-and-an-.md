---
id: 01a131c7-7066-7782-84b6-278a389eaa72
title: Project-scoped thread search answers in milliseconds, and an abandoned read frees its reader lane
ord: 47
tags: ["task"]
fields:
  {
    "holder": "tagma:01a131b6-5601-7514-aac0-b0dce060456a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a131c1-cdbc-7812-bf69-ee6f16e32b57
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/palette/Feed.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/conversationReads.ts
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/ProcessPool.ts
---
Thread search (`search_threads`, palette) with one project's scope hangs for minutes: on the shipped SQLite 3.51.3 with no `sqlite_stat1` the planner leads the query from `thread` by `project_id`, while FTS checks each of the project's messages (~58k) with a `rowid = ? AND MATCH` probe. A client-cancelled request holds the reader lane until the statement ends, so the palette, which cancels a request on every keystroke, clogs the lanes, and its feed shows the past set's `query-too-short` refusal while the new request hangs.

What to do:
- `apps/tagma/server/src/threads/journal/conversationReads.ts`, `chunkOf` and `tallyOf`: FTS as the leading table via `cross join`, as in `graph/search/ranking.ts`.
- `packages/sqlite-process`: a read on a reader lane whose caller was interrupted before the answer drops its lane's process at once; the process's neighbouring connections take the loss until the lane is freed. The writer awaits the answer, as before.
- `apps/tagma/app/src/lib/features/palette/Feed.svelte.ts`: a new request resets the past refusal.

Done when: the project-scope plan on the shipped engine leads from FTS and answers in milliseconds on the operator's database; the package integration test shows an interrupted long read frees the lane and the next read answers; typecheck and affected tests are green.

Outcome (22f6f30bc0). Measurements — one sample on the operator's database (SQLite 3.51.3, ~58k messages), a real read-only SQL `chunkOf` run:
- project scope: was over 100 s (~110 s chunk plus ~105 s tally in serve.log), became 1–22 ms;
- worst case of the new order (frequent word, two-message project): 25 ms on a warm cache, 880 ms on a cold one.

The "interrupted read frees the lane and the neighbouring store keeps reading" test is red on the old behaviour (interrupt hangs until the 3 s timeout) and green on the new. The `Feed` test is checked the same: red on the old code, green on the new. Four failing package itests fixed along the way: they ignored the store's separate on-disk checkpoint process. `sqlite-process` 38 itest and 17 unit, `conversations.itest` 19, package and app typecheck — green.

Unproved:
- the running server was never restarted, the operator checks live palette behaviour after restart;
- no review ran: delegation for the thread is switched off by the operator;
- the server typecheck falls on two errors in `commandLanding.stest.ts` — unfinished rows of another session, not this work.
