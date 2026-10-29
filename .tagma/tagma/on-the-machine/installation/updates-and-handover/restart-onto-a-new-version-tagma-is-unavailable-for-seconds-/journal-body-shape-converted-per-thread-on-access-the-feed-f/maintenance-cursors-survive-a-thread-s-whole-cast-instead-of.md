---
id: 01a188b7-9ed3-7993-b307-115087c6db47
title: Maintenance cursors survive a thread's whole cast instead of restarting from the thread's first entry
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188b8-3a09-7e1f-8c65-8042fca3d077",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ee8d4a4eb8
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/maintenance/bounding.ts
---
A whole cast unloads a SQL-resident thread and returns it (`rollouts.rehydrate` → `whole.resident`), and the return rebuilds `thread_log`, so maintenance cursors such as `boundedThrough` (`native-harness/maintenance/bounding.ts`) start from nothing and maintenance walks the whole thread again once. Find every maintenance cursor the return drops, and carry what stays true across it, or show that a re-walk is needed because the return writes back bodies maintenance already rewrote, and remove that cause.