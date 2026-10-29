---
id: 01a126f6-6c5e-795a-b256-2e311e57a53b
title: A journal shape step applies on every read; the thread mark moves only with its store rows
ord: 133
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/formSteps.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutEntryForms.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutWhole.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/fields.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/rows/threadUnits.ts
    symbol: makeThreadUnits
---
`ThreadEntryReader` applies steps to every decoded record with no mark check. By contract a step never changes a record in the current shape, so the reader always yields the current shape, and the mark decides whether to cast the whole thread. Maintenance decodes picked records with the same reader and never waits for the whole-thread mark; a current shape it wrote passes a repeated step unchanged by the fixed-point contract. Steps run one by one: a step shapes a whole event — payload, entry and messages inside — before the next one reads it.

A thread is born with mark `step = last` in the same record as its journal row (`insertRow`): its rows and file are written by current code, nothing to cast. Without this mark every new thread counted as lagging, and the first read after its first run unloaded and returned it whole — right under the run settlement whose out-of-lane reads then failed.

Nothing walks lagging threads: a thread whose mark is null or behind is cast only when accessed, and an unaccessed one keeps its old mark and bytes. A null mark — a row from before the `step` column — counts as lagging, so that thread takes every step on its next access, which the fixed-point contract makes safe. A read of an unloaded thread never shapes its file: `RolloutForms.readable` only refuses an unformable or older-than-base file, settles a publication a crash left behind and opens a compressed file; shaping is queued (`formRested`) and never awaited, while decoding applies the steps. The queued cast stages the shaped file beside the lane (`stagedRollout`, under `.staging`), writing nothing but a settle its unit re-checks, so readers neither wait on the lane nor on `uses.rest` while it streams; only the commit — store record, rename, settle — runs in the lane under `uses.rest`. The commit first compares what staging stood on (form row, cursor and refusal offsets, rest stamp, file size and mtime) and answers `moved` without writing when anything changed: a record appended meanwhile is never lost or reshaped by a stale stage. A commit refused because the thread is in use, or moved, stays owed and runs again when the thread's last use ends.

`formRollout` applies steps to the file of an unloaded thread or to a file with no thread row in the store; it sets the mark only for a standing row and never touches the mark on `last`. A step spans the meta of the header and tail records: a moved rollout home may be the only recovery source a SQL migration never reaches. The journal copy in SQL is collapsed and rewritten by maintenance independently of the file, so a shaped file says nothing about store rows. A SQL-lying thread is cast whole only in one journal-lane pass: catch the cursor up, unload without transcript, shape the file, return. While a run is going or the file lags, cast waits for the next access. Exception — lagging only by steps with no `payload`, `entry` or `message`: SQL event rows never change through them, so `formRollout` shapes such a thread's file in place, parsing no event rows, and `reading` in SQL in the same record, with no unload or return.

A step refusal — on a file row, in `stream_tail`, `context_reading` or `pending_interaction` — refuses the whole act and is recorded in the mark refusal. Paths SQL reads over many threads are declared in `store/fields.ts`. Instruction-snapshot selection inside one thread applies the runtimeState key filter only after the shape mark; before it, it reads that thread's messages and shapes them before the key search. A step that changed such a path refuses: that is a history-table schema change.
