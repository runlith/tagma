---
id: 01a196af-58df-7be5-8b7d-aa8b70cc770f
title: Snapshot publications receive the original restore transaction
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/snapshots.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/snapshot.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutSnapshot.ts
---
Snapshot participants prepare the selected pre-migration tables in a temporary database. Their publication callbacks receive the original store inside its restore transaction, so an owner can invalidate metadata derived from restored files even when the migration selected different tables. Thread rollout publication clears the original import markers at this boundary, allowing recovery to discover the restored files. Callback SQL rolls back with the table restore; file changes already published are recovered through the durable restore intent, which retains the same restoration identity across retries. The offline caller holds exclusive ownership of the data directory, and the supplied store belongs to the callback's execution lifetime. On the machine store the same transaction then rebinds row-fact capture to the restored tables and commits one gap, so every follower recovers from a fresh cut; a rolled-back restore keeps the capture it had.