---
id: 01a0c6b7-0029-79c9-8f12-888734ef601b
title: Bound the writer hold a wake takes, without letting a reader meet a half-woken thread
ord: 116
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6b3-0548-72c9-afaa-6f31208c5d66
sources:
  - kind: file
    ref: apps/tagma/server/src/files/ThreadRolloutSync.ts
  - kind: file
    ref: apps/tagma/server/src/harness/ThreadRollouts.ts
---
Start at `rehydrateThreadRecords` and the unit it opens: rows, cursor and evicted stamp land together today, which is what makes a wake hold the shared writer for as long as the file takes to replay — 0.4 to 15.6 seconds on real material.

Read the decision before choosing a means; the reader-visible guarantee is what may not move. Weigh at least a waking state that lets records land in bounded units while a reader is told what it is meeting, and serving a rested thread's transcript from its rollout without waking it at all — the second removes the cost rather than dividing it, and may be the smaller change for the reader-facing half.

Measure against the same threads that produced the 15.6 s hold, not against a fixture, and state the bound the change takes rather than reporting an average.