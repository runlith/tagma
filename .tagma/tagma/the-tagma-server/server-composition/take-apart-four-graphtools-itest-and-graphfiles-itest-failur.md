---
id: 01a13da0-f5a5-7289-984c-03bf713f8227
title: "Take apart four graphTools.itest and graphFiles.itest failures: a stale test contract or a regression"
ord: 34
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d2f-a3e0-7cc0-a17c-9c9d0b187a53",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-397d-7dd5-bf80-bb4321165a9f
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/native-harness/graphFiles.itest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/native-harness/graphTools.itest.ts
---
For each: compare with HEAD and decide — the test holds a stale contract (then the test) or the code regressed (then the code, test red → green). The batch-source hypothesis: 1843774dab moved Batch.held to a refusal instead of an empty answer.

Done when all four are green and each decision is named in the commit.
