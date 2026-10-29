---
id: 01a14d1f-5b67-7bec-8069-a0844491024e
title: Cancelling a graph git creation leaves no half-repository
ord: 74
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae6-7c7d-9cc2-edc404b6eb7f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c18-c833-7d88-b3bd-66eb312abbba
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/shadow.ts
---
In native parity after fast Stops, the next graph opening failed: git does not recognize the repository; an isolated scenario passes. In ShadowGit.open/openInPlace, an existing directory counts as a finished init, although git init is interruptible and may already have created the directory. Verify the cancel on the Git boundary with a suspended init, fix ownership of the unfinished init in ShadowGit, and prove reopening with real git. This result belongs to the single review of the whole parent work.
