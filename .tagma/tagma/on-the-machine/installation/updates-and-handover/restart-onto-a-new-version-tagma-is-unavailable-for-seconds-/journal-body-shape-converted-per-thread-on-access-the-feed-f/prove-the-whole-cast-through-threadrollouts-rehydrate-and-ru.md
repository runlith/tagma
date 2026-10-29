---
id: 01a188b7-9f18-7822-96d9-89b17aab6a42
title: Prove the whole cast through ThreadRollouts.rehydrate and run recovery of a lagging thread
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ee8d4a4eb8
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutRehydrate.ts
---
The spec's acceptance needs, through the real `ThreadRollouts.rehydrate`: after access, a lagging SQL-resident thread reads in the current shape from SQL and from its file, and its mark is the last step; a neighbouring thread nobody accessed keeps its old mark and bytes; run recovery in a lagging thread reads `stream_tail` and history in the current shape.