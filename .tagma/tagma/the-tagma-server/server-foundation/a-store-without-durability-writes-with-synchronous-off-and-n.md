---
id: 01a16b34-aa7b-781a-b3d2-f39d3c17b3f1
title: A store without durability writes with synchronous=OFF and no fsync in checkpoint, and graph mirrors take the durability of their machine store
ord: 31
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/storage/baseline.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/open.ts
  - kind: file
    ref: packages/sqlite-process/src/Checkpoints.ts
---
Only the test composition picks `durable: false`; the server and CLI keep server stores durable, and the default behaviour stands. Such a store writes with `synchronous=OFF`, transactions never raise it to FULL/NORMAL even in `WriteSetMode = 'refuse'`, and a checkpoint pass over its file runs without FULL and fullfsync.

Graph mirrors open on the machine store pool with its durability: one runtime decision. If mirrors held durability separately, the test world would pay fsync on every mirror commit even though its machine database is already non-durable.
