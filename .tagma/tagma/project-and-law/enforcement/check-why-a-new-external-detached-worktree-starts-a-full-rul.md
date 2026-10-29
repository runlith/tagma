---
id: 01a172fc-c788-7dbd-a127-9cf0898bef41
title: Check why a new external detached worktree starts a full rule remeasure
ord: 84
tags: ["task"]
fields:
  {
    "holder": "tagma:01a172fa-4013-7347-9163-c519e5d1dcfc",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16f2e-d69c-77f2-a5ea-b3d063cc7c2c
---
Discovery bug not confirmed. The [[01a16a94-8d3a-7610-abd9-8503665bc41f|source thread]], record 8665: after worktree creation a separate bash reads package.json in it. Saved trace 8bdc2487a9edb33ae4318947e539dfc3 links that toolCallId to harness.touch → GraphPool.open at 20:31:01+02; then swallowed-failures runs 7.99 s. Current Coverage.onCovered leads to remeasures.reconcile, which only removes departed places; Start arrives when the copy opens. A fresh worktree has no checkpoint of its own; equality of the historic tree, the full declaration with ledger/reach and implementation to the main measurement isn't proved. Check by idleCopies.itest.ts through real HTTP operations and worktrees.subscribe: 1 pass, 0 fail, 20 assertions, 11.69 s. Code and policy unchanged.
