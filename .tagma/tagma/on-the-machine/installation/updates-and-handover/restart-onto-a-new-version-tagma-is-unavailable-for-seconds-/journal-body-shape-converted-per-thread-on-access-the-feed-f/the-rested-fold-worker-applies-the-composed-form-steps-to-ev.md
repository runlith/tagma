---
id: 01a188b7-9e8a-7d0d-bd44-2c1207ffe778
title: The rested fold worker applies the composed form steps to every rollout line it folds
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188b8-39f2-77b9-b7ea-b5b3634f9545",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ee8d4a4eb8
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/rested.worker.ts
---
`native-harness/transcript/rested.worker.ts` decodes rollout lines with `decodeThreadEventFacetsResult`, so the `.entries` transcript, the folded history and guidance of an offloaded thread miss the payload and message steps until the queued cast lands, and the history is cached by the cursor key. Steps are functions and cannot cross the worker boundary as data. native-harness declares in its own contract what the worker needs to load the steps; composition fills it from the composed step list (`ENTRY_KINDS`), and the worker decodes through the same `ThreadEntryReader` the main thread uses. native-harness never imports composition (rules e090f46d, 6f758080).