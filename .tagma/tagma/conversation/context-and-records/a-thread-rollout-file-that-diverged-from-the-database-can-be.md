---
id: 01a14bc0-7683-7815-8eed-9d3717c9c033
title: A thread rollout file that diverged from the database can be examined and repaired with no entries lost
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-767b-73c0-89c8-7ffb0a4dca9c
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/report.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutReconciling.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutRepairing.ts
---
**Value.** A thread whose rollout file diverged from the database after a failure can be taken apart and fixed without losing a single entry.

**How.** The `read_thread_rollout` and `repair_thread_rollout` operations, available to operator and agent.

**Behaviour.** Server loading compares every file against the database and records disagreement. Reading shows that disagreement and the window of file entries against database rows; no recorded disagreement does not prove the file matches whole. Repair renumbers entries in order, keeping their contents and order, and leaves the original beside it.

**Limits.** An entry that cannot be read is not invented by repair, which refuses.
