---
id: 01a15134-0b9f-7e2c-809e-ec1fa8827ffd
title: Shared commit queue compaction fully reads and rewrites the journal on the server loop
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-a7fb-750d-b9ca-d956ac4fe229",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/queue.ts
---
Remove full compaction of the shared commit queue journal from the server loop while keeping durable admission and recovery: the backlog limit is per project, and unread lines are preserved, so the shared pass is unbounded. Implemented at the journal owner: one scoped worker restores state and maintains it incrementally; compaction writes only known retained records without re-reading history. Admission, settlement, and close are serialized; admission answers after fsync, unread is preserved. Verified through CommitQueue: 9 unit/integration tests passed, including compaction with concurrent admission and repeated recovery with sync read/write banned on the calling loop. A shared `bun run typecheck` found errors of others' unfinished changes, with no diagnostics in queue/journal or their tests. Live-server delay, large-scale p99s, and emergency power loss weren't measured; the original risk was established from code, a lone fsync wasn't declared a defect on its own.
