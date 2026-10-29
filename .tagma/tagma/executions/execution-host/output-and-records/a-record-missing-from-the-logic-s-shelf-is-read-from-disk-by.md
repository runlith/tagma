---
id: 01a14110-3474-75cf-b27b-b2bc940f62ec
title: A record missing from the logic's shelf is read from disk by the store line, the current generation's too
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/RecordShelf.ts
  - kind: file
    ref: packages/execution-host/src/RetainedRecordReads.ts
  - kind: file
    ref: packages/execution-host/src/subscriptions.ts
---
The shelf (`released`) lives in the logic's memory. A logic change keeps the generation, but the new logic starts with an empty shelf: command records the old logic set aside after the end stand on disk and in the store (`record_availability = available`), while the new shelf's memory lacks them — it only counts them in its share and evicts per [[4d94aa4b]]. So a read that finds the execution neither among the held nor on the shelf goes to `RetainedRecordReads` for any generation no newer than current, and `evidenceOf` answers with the current generation's line just as with a set-aside one. Otherwise `read_output` for a command that ended before the restart refused `UnknownExecution` while its bytes were intact. A byte subscription takes such a record the same way: after awaiting an ongoing publication onto the shelf it tries the first read and refuses `UnknownExecution` only if that read found no record either. One shelf cannot decide: a window that opened a terminal which ended before the logic change got a subscription refusal with intact bytes.

A record the shelf evicted or dropped the store marks `unavailable`, and such a read answers `missing`, not someone else's bytes.
