---
id: 01a14bae-6720-7d62-897a-9288c2f9fd4b
title: Thread is archived or deleted with everything it produced
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9286739b512c
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928951e208b5
  - kind: supersedes
    to: 01a14b6d-b232-71fe-b90e-a840496c190e
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
    symbol: THREAD_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/threads/operations/acts.ts
    symbol: ACT_PAIRS
---
**Value.** A finished team is removed with one act: archiving hides the thread with everything it produced, destroying nothing; deletion wipes it for good and frees everything the thread held.

**How.** The row menu; operations `archive_thread`, `archive_threads` (by a time window), `delete_thread`.

**Behaviour.** Archiving first stops every run and CLI of the subtree and releases their resources, then sets the mark; the transcript stays, and unarchiving returns exactly that group. The operator's word in an archived thread lifts the archive, while another agent's word waits in the queue. Mass archiving leaves working threads standing and names them. An agent archives its own subtree without asking; someone else's, its own thread, or an ancestor — only on the operator's word.

**Limits.** Deletion asks the operator already in trust mode; its own thread and ancestors cannot be deleted in any mode. An unconfirmed resource release leaves the thread unarchived or undeleted.
