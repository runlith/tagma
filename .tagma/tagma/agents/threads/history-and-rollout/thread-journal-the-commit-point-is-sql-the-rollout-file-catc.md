---
id: 01a102b2-08ce-74cf-a233-52e6df760b9f
title: "Thread journal: the commit point is SQL, the rollout file catches up with the log by positions"
ord: 1
---
A thread event commits in SQL; the rollout file is an ordered copy of the log that catches up with it and never runs ahead. Code: `apps/tagma/server/src/threads/journal/log.ts`, `rolloutWriter.ts`, open in the journal lane — `threads/harness/engine.ts`.

- **Commit.** The event position is issued by `thread_event` in the same write unit (`max(position)+1`). Event, fold, and keyed record commit together. Only SQL runs under the machine writer.
- **File write.** The unit's rows reach the rollout as the unit tail after COMMIT (`afterCommit`), before answering the caller, with one write per unit and thread. A rollback leaves no row. The floor writes only rows continuing the file head: a head gap or a write failure drops the thread from the floor, and the next open catches it up. A finished write advances only the head it started with: a dropped or reopened head is not overwritten by an old completion.
- **Open.** The journal lane opens the journal before the write unit: it reads the file tail, births the file, cuts the ragged tail, and adopts under its own numbers the rows that are in SQL but not in the file. If the journal cannot be opened — the old journal is lost, the file is not a rollout, the file runs ahead of the log, an I/O error — the thread's next append refuses before commit. A transition without events passes. A writer outside the lane writing into an existing thread (merge notice) opens the journal in its preparation before the unit. An append whose position the file already holds (log rows removed, file left behind) refuses inside the unit: without that check the SQL position would diverge from the file.
- **Lag.** The file lags SQL after a failure between COMMIT and the write, and after an append outside the lane (a newborn child's seed, later written out by export). Eviction removes SQL rows only once the file part checked by the projection holds the log head; otherwise `records-missing`. The head is read in the same transaction that removes rows, so a commit slipping in between check and removal is not lost.
- **Limits.** Boot reconcile by pending markers and replay from the file after base loss work as before. Base loss before catch-up loses rows the file has not yet received.
