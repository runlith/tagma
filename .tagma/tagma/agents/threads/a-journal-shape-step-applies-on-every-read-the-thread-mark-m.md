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

`formRollout` applies steps to the file of an unloaded thread or to a file with no thread row in the store; it sets the mark only for a standing row and never touches the mark on `last`. A step spans the meta of the header and tail records: a moved rollout home may be the only recovery source a SQL migration never reaches. The journal copy in SQL is collapsed and rewritten by maintenance independently of the file, so a shaped file says nothing about store rows. A SQL-lying thread is cast whole only in one journal-lane pass: catch the cursor up, unload without transcript, shape the file, return. While a run is going or the file lags, cast waits for the next access. Exception — lagging only by steps with no `payload`, `entry` or `message`: SQL event rows never change through them, so `formRollout` shapes such a thread's file in place, parsing no event rows, and `reading` in SQL in the same record, with no unload or return.

A step refusal — on a file row, in `stream_tail`, `context_reading` or `pending_interaction` — refuses the whole act and is recorded in the mark refusal. Paths SQL reads over many threads are declared in `store/fields.ts`. Instruction-snapshot selection inside one thread applies the runtimeState key filter only after the shape mark; before it, it reads that thread's messages and shapes them before the key search. A step that changed such a path refuses: that is a history-table schema change.
