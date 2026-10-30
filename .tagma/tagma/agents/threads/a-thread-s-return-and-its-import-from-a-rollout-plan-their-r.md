---
id: 01a18c1c-f138-7135-89d4-09b1e589ef21
title: A thread's return and its import from a rollout plan their rows in the reader's worker and hand them over batch by batch
ord: 139
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18bea-b9f0-7ddc-8922-0f75c9b1f9f8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18c05-00ad-7aac-9961-6aa6a57d547f
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/replay.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutReconciling.ts
---
`rehydrateThreadRecords` (the return of an offloaded thread) and `replayThreadRollout` (import from a rollout file) load the whole journal into the server's memory (`replayRollout`) and, in one synchronous pass on the event loop, decode every event, size every row and fold the native history and transcript (`carryPlan` → `native.rows`). Cost grows with the journal: rollouts here run p50 2.2 MB, p99 40 MB, max 660 MB. Reconciliation also keeps every source rollout of a branch in memory and parses a whole file only to read its meta base (`rolloutBase`).

Do: the reader's worker scans the file, decodes, folds and batches (`carry` on the native part's port, beside `stage`), keeps the plan and answers it one bounded batch per ask; the loop only writes each batch in its own unit. Standing SQL residue is checked by id inside the worker, a base is read by a meta ask, and branch sources go to the worker as paths.