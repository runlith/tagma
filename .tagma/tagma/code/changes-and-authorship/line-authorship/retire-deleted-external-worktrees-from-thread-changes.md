---
id: 01a18dbb-818e-7c71-b481-60300ea61522
title: Retire deleted external worktrees from thread changes
ord: 153
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18db3-cd7a-7144-9b61-bdc972c6d6e4",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
---
Retire a git-removed external worktree from thread changes without confusing a failed HEAD read with an absent commit. The shared HEAD observer reports failed attempts through its existing recovery cadence; retirement follows registered paths and asks the root registry to prove deletion. The real Changes socket regression fails before the fix and passes after it, retaining the other checkout and checkout-gone history. The observation and socket files pass on three shuffle seeds; real watcher, root-identity and change-frame suites pass. Server typechecking remains blocked by pre-existing DOM-global errors in column.e2e.ts and undeclaredRefusal in reflections/operations.ts.