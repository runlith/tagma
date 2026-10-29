---
id: 01a130b1-5703-76d7-aa03-a6210f1891d5
title: A failing flush of one stealth copy of the repository drops topology and reading of another copy
ord: 222
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1205b-860f-7204-8ede-30bea586c5d8",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
---
`graph/serving/freshness.ts` `prepareTopology` (~229–233): a flush of any held stealth copy of the repository drops topology/read of another. The operator's principle: one copy's failure is isolated in it and named, work on the current one goes on as usual. Done: a test — one copy fails on flush, reading the other answers, the first failure named.
