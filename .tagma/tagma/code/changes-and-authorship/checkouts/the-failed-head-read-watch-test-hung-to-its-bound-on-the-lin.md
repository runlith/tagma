---
id: 01a1b1f7-95fc-7ed2-b3bb-de2359e36e25
title: The failed-HEAD-read watch test hung to its bound on the Linux runner
ord: 34
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/watch/heads.itest.ts
---
In Linux integration run 42258680947 `apps/tagma/server/src/workspace/watch/heads.itest.ts` — "a failed HEAD read preserves the healthy watcher and its observation until reading recovers" — logged the injected `GitUnreadable` ("HEAD reading resource unavailable") and then waited until the 180 s bound. Find the await that never got its fact (the recovery read, the watcher event or the observation) and end it on that fact.