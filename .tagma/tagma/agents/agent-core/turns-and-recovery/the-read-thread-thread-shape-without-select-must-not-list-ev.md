---
id: 01a15177-250c-7f78-8b03-44e18006d667
title: The read_thread thread shape without select must not list every run in full
ord: 8
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a15175-d7ed-72da-96f2-825590eedd86
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/evidence.ts
---
`read_thread {threadId}` without `select` returns every run of the thread in `runs` with its full `settledNotification`: on thread 01a15109-4b72-7dbf-b535-d208cbfa63d4 (about a hundred runs) the response weighed 232 KB and went into truncated output. The shape must stay bounded from above for any number of runs: the latest runs and their count, the rest via `select: runs` with `limit`. Start from `threadShapeSchema.runs` (`threads/contract/wire/evidence.ts`) and whoever assembles `ThreadEvidenceSnapshot.shape.runs`.
