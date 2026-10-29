---
id: 01a1513f-5773-74c1-a1e3-156cf9135d0f
title: The commit queue rewrites retained records in a single worker without re-reading history
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/journal.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/journal.worker.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/commits/queue.ts
    symbol: openJournal
---
The worker solely owns the journal file and its restored state: compaction can't overwrite a concurrent admission, and unreadable lines are preserved for an honest preflight downgrade. A lost ACK proves nothing about whether the write happened: such a request isn't repeated, the preceding worker closes before the new one recovers, and journal reconciliation with the already finished court runs in the worker. Reserved seqs survive worker replacement even after the file is emptied; the current court outside the semaphore finishes the same record, while further traversal takes a new snapshot. Admission, settlement, recovery, and close are ordered by one semaphore; if recovery fails, the undefined admission keeps blocking draining. Durable settlement removes unstruck even with a lost ACK; a journal record left with a successful court stays unstruck until a new scope.
