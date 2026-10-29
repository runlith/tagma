---
id: 01a18916-9d51-73ee-bcf5-883826a42062
title: After start, a driver reconciles only the threads marked with an unfinished write, behind run recovery
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18903-02e6-7cf3-a738-01f7a592aa92",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79e89b246531
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/engine.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutReconciling.ts
---
No server code calls `ThreadRollouts.replay()`: marks under the rollout home's `.pending` are written on every write and never consumed, so a thread whose file outran a rolled-back database is never brought back at start. Drive `replay()` once per start after `Maintenance.opened`, which opens only after run recovery; once the database has imported its home, `replay()` reads only marked threads.