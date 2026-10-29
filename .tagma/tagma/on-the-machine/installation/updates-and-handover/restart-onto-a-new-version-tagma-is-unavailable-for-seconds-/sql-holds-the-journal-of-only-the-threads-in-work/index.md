---
id: 01a12699-1673-714b-a6a5-79efc3af42eb
title: SQL holds the journal of only the threads in work
ord: 9
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rest.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutEviction.ts
---
The machine database keeps the journal of only the threads currently in work. The rest lie in rollout files and return to SQL when addressed. The database stops growing with the archived thread count, and eviction no longer contends with the person in the first seconds after start.

This part does not shrink the window by itself: under the migration law and with per-thread shapes it already stops depending on database size. It is needed so the declared heavy update and database servicing stay cheap, and so post-start work does not grow with history.

## What stands today

Measured on one machine: the journal in SQL is held by 962 of 3204 threads — 354 unarchived and 608 archived.

- **Archiving does not evict.** Only the idle pass evicts: at server start and then once a day, up to 2000 threads per pass, `idleProjectionDays` threshold 7 days (`threads/journal/rolloutEviction.ts`).
- **The pass at start runs in the first 10–50 s after launch**, up to 4.3 s per thread, and contends with work right after restart.
- **18 threads stand evicted but with rows in SQL, and that is the only copy of those rows.** Migration `20261009021800_terminal_runs` inserted events into the journal of already-evicted threads, counting position over empty SQL; the files lack these events. A return as of today would delete them: it clears SQL and fills it from the file (`threads/journal/replay.ts`, `rehydrateThreadRecords`).
- **An interrupted return completes on next addressing:** the eviction mark is cleared by the return's last transaction.
- **Reading returns the thread to SQL.** `read_thread` returns first, so reading facts over N archived threads leaves N journals in the database until the next pass. One measured return: 52.5 MB in 1.86 s.
- **The "said" list row** of an evicted thread disappears: it is read from the journal body (`threads/list/select.ts:235-279`).
- **`thread_run_transition` is 12.5 GB of 23.1 GB** in a database-copy breakdown: 654,601 rows, one transition answer up to 23 MB. This is not history but run-transition idempotency accounting — the request digest and the answer for a retry (`native-harness/runs/transitionStore.ts`); it is written on every transition and never deleted.
- **Commands and terminals are tied to a thread by text, without a foreign key** (`command.owner_thread`; `terminal.origin` and `holder` of `thread:<id>` form), and deleting a thread does not touch them: 54,179 commands of deleted threads on a copy. Runs, messages, inboxes, and thread calls cascade.

## What is built

- **An archived thread is evicted right after archiving** — by a separate act in the thread's lane, in portions. The archiving act itself holds no eviction: one eviction costs up to seconds under the database writer, and archiving also runs in batches. An archived thread has no running work ([[f1e01bec]]).
- **An archived thread returned by a read is evicted by the same driver** once the read finishes. No second facts reader from files stands beside SQL: one owner answers the thread's facts, as today.
- **The idle pass does not start until running runs are recovered,** and runs in portions yielding to human work: one eviction holds the database writer no longer than a portion, and its file reads and computation run in a worker.
- **While the eviction mark stands, the file holds the journal truth.** Eviction and return write in portions under that mark, and while it stands the journal reads from file rows, not SQL rows. The return clears the mark with its last transaction, so an interrupted return completes on next addressing; there is no separate pass sweeping interrupted returns. SQL rows missing from the file are appended to the file's end before clearing and never deleted as spare.
- **The list row is stored on the thread** and written when the record is appended, not derived from the journal when the list reads; it survives eviction. For unarchived threads lying in SQL at conversion time, a one-time pass after start fills it ([[842e3529]]), freshest first: on a clone, filling all 969 threads cost 2.9 s in the measurement, and it does not enter the window. Archived and already-evicted threads keep the row empty, as today, until the next record.

The spec promises nothing about the database file size: freed pages stay in the file and are reused.

## What accumulates outside the journal

Commands, terminals, run-transition accounting, root uses, and holds currently accumulate with no deletion — hundreds of thousands of rows per table in one measurement.

- **Nothing is deleted by calendar.** A person must never find their history gone by date.
- **A thread's history lives while the thread lives** and is deleted with it: its commands, finished terminals, runs, messages. Where the thread tie is textual, the table owner deletes the rows when the thread is deleted. What thread deletion does to a live terminal, the spec does not change.
- **Service accounting keeps only what can still be read, and no longer than the work it accounted for:** root uses, holds, request keys, run-transition accounting. Transition accounting holds only what a transition retry can still request, and disappears with the run's end.
- **What already accumulated is deleted once, after start:** in portions awaited by no human operation. In the database opening at conversion, only what keeps the opening correct remains — the ledger conversion and schema migrations.

Which table belongs to which kind, the performer determines by code and by the database-copy breakdown.

## What the performer proves

- After archiving, the thread's journal rows are gone from SQL, and the thread opens from the file with the same feed; archiving a batch of threads holds the database writer no longer than without eviction.
- An archived thread read by `read_thread` is evicted again after the read.
- After start, no eviction begins before running runs are recovered.
- A return interrupted between transactions completes on next addressing of the thread, and until then the journal reads from the file.
- Returning a thread whose SQL holds rows missing from the file keeps them in the file and in the feed.
- The thread's list row is identical before and after eviction.
- Deleting a thread leaves none of its commands, finished terminals, or other history in any table, and a finished run leaves no transition accounting.
- On the operator's database copy, opening with conversion is shown as a sample and fits the window budget, and after the one-time passes there is no transition accounting of finished runs and no commands of deleted threads.
