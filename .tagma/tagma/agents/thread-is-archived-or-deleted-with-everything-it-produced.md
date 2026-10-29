---
id: 01a14b6d-b232-71fe-b90e-a840496c190e
title: Thread is archived or deleted with everything it produced
ord: 19
---
A finished team is removed with one act: archiving hides the thread with everything it produced, destroying nothing; deletion wipes it for good.

**Archive.** `archive_thread` (operator, agent, plugin for its own thread) and the row menu: the thread and its whole subtree leave the list; every run and CLI under it stops, foreground and background work is lifted, transport resources are released, and only then is the mark set. Transcript, runs, and reads stay; `archived: false` returns exactly that group. The operator's word in an archived thread opens a run and lifts the archive. `archive_threads` — by a window on the clocks (created, updated, read, archived) in one act; working threads are left standing and named. An agent archives its own subtree without asking, working or not; anything outside the subtree, its own thread, or an ancestor — only on the operator's word (the calling run goes to its end).

**Deletion.** `delete_thread`: the run stops, processes, executions, and guests under the thread end, the transcript and records go with the row — nothing returns. Asks the operator from the trust mode. Its own thread and ancestors cannot be deleted in any mode (`own-lineage`).

**Limits and refusals.** A run that does not settle within the ending patience — `still-settling` (the whole tree stands); an unconfirmed resource release leaves the thread unarchived or undeleted (`stop-timed-out`, `cli-standing`, `session-uncertain`, and others). An outside caller that is not a plugin — `external-refused`; another thread's plugin — `plugin-thread-mismatch`.

Code: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts#THREAD_OPERATIONS, apps/tagma/server/src/threads/operations/acts.ts#ACT_PAIRS, apps/tagma/server/src/threads/ending.ts
