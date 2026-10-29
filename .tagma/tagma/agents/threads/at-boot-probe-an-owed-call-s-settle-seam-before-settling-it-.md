---
id: 01a0ef8a-2f2f-71f9-a62e-9278cb1d1381
title: At boot, probe an owed call's `settle` seam before settling it interrupted
ord: 88
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0ef52-d739-70b6-a9e5-20ac3bfd8b95
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/collaboration/callEndings.ts
    symbol: CallEndings
---
The boot walk settles every row a previous process left without an ending `interrupted` ([[451d2392]]). An operation that declares a `settle` seam (graph writes read their journal; `manual` identities) can prove whether its effect happened, so the walk could answer `completed` with the evidence or `aborted` instead of "unknown". Start at `CallEndings.resume` (threads/collaboration/callEndings.ts) and the native door's `settleEffect` (invocation/nativeDoor.ts); done when a graph write detached across a restart is delivered as happened or not-happened.