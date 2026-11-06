---
id: 01a1ad9b-88ae-77ff-89fd-5efc24b4dbd8
title: A thread fact column whose text is not JSON reads as that text, and SQL reads its fields only through `readableField`
ord: 169
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1ad42-04ef-744c-89dc-278436fdc3f7
  - kind: relates
    to: 01a1ad6e-b0c9-701b-bbc0-b90da4a61a64
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/readableJson.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/kernel.ts
  - kind: file
    ref: apps/tagma/server/src/threads/store/mandate.ts
  - kind: file
    ref: apps/tagma/server/src/thread-record/store/table.ts
---
`native_thread.transport` and `context_reading`, `thread_mandate.authority`, `thread.born_of` and the run facts of `thread_run` (progress, usage, stream tail, failure, settled notification, stop request, withdrawn words) are `readableJson` columns: text that does not parse reaches its reader as that string, which every shape reading in `persisted.ts` refuses, so the row degrades and is told like a shape this build cannot read. Tagma writes only JSON there, so such text comes from an edit outside Tagma; drizzle's JSON mode would throw on it while decoding and fail the whole query, the project list and every sweep over running runs with it.

A run's facts read through `runFacts` in `persisted.ts`, row by row, so a sweep or a write over many runs degrades the one row that does not read instead of failing the batch.

SQL that reads a field of these columns goes through `readableField`, which answers null for text that is not JSON: a bare `json_extract` throws `malformed JSON` and fails the statement for every row it scans. A `json_set` or `json_remove` over them goes through `readableEdit`, which leaves such text as it stands, so the write lands and the reading keeps telling.

`capabilities` and `pending_interaction` stay plain JSON columns because SQLite already refuses text that is not JSON on any write to them: the virtual column `call_envelope_ms` and the partial question indexes evaluate `json_extract` over them on every insert and update. Dropping that column or those indexes lets such text in, and their readers then need the same treatment.
