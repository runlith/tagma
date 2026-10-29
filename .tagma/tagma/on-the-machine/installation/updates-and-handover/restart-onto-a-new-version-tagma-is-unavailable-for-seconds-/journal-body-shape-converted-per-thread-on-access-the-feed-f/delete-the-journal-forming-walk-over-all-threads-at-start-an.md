---
id: 01a1889e-d966-72dc-9be5-d3a4189c0df4
title: Delete the journal forming walk over all threads at start and every 24 h
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1889a-6037-78a2-8d09-8777b74bd780",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ee8d4a4eb8
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutWhole.ts
---
`formingSweep` (`threads/journal/projectionSweep.ts`) runs `ThreadRollouts.formLagging` (`rolloutWhole.ts`) from `scheduleSweeps('thread-sweeps')` in `threads/harness/engine.ts`: at start and every 24 h it casts every thread whose mark is null, behind or publishing. The spec deletes that walk: a thread is cast only when accessed. Delete `formLagging`, its sweep and its contract member; a null mark keeps counting as lagging, so such a thread takes every step on its next access, which the fixed-point contract makes safe.