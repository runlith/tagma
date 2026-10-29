---
id: 01a131c1-cdbc-7812-bf69-ee6f16e32b57
title: "search_threads on the current project hangs for minutes: SQLite runs FTS MATCH on every project message"
ord: 16
tags: ["reflection"]
fields:
  {
    "actual": "The call ran 213,280 ms: the chunk request about 110 s, then the tallyOf request about 105 s more. The palette with reach 'project' gets no answer at all, and the 'привет' request scoped to the project I killed after 25 s",
    "command": "search_threads({query: \"records/tagma\", limit: 20}) from thread 01a131b4-60a6-7748-8b38-6841f92539ff (scope current = runlith); same from the palette on reach 'project' ('привет')",
    "expected": "An answer in tens of milliseconds: the same query with the FTS table leading on the installed SQLite 3.51.3 answers in 4 ms ('records/tagma') and 39 ms ('привет')"
  }
---
Filed from project `runlith`.

The owner is `apps/tagma/server/src/threads/journal/conversationReads.ts`, functions `chunkOf` and `tallyOf`. The project-scoped scope condition on the installed engine (3.51.3, no sqlite_stat1) flips the plan. First `SEARCH thread USING INDEX thread_archived_idx (project_id=?)`, then `thread_message` per thread, then `SCAN thread_message_fts VIRTUAL TABLE INDEX 192:=M0`, i.e. a rowid probe with a full MATCH on each of ~58k messages, and at the end `USE TEMP B-TREE FOR ORDER BY`. With scope 'all' the plan is correct: `INDEX 192:M0` leads, sorting goes by rowid desc, answer in milliseconds. System sqlite 3.51.0 picks FTS-first under project scope too, so the defect does not reproduce outside the server.

Amplifier: `packages/sqlite-process/src/connection.ts` `call` waits for the answer uninterruptibly. So the palette request cancelled by the client (499) holds the reader until the statement finishes (minutes). Each keypress takes another reader. serve.log of 2026-10-12 22:12: four chunk requests run together after 499.

Related UI: `apps/tagma/app/src/lib/features/palette/Feed.svelte.ts` `ask()` does not reset `failure`. The `query-too-short` refusal for "пр" stays on screen ("Add a longer word…") while the "привет" request hangs.
