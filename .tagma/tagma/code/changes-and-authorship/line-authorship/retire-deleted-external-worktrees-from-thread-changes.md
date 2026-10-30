---
id: 01a18dbb-818e-7c71-b481-60300ea61522
title: Retire deleted external worktrees from thread changes
ord: 153
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18db3-cd7a-7144-9b61-bdc972c6d6e4",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bef0-716f-98eb-0a3806405a5f
---
Fix the lifecycle that leaves a git-removed temporary worktree as a stale side of thread changes. Reproduce the reported shell-created worktree through the real Changes door, retire its held records only on proven deletion, preserve moved worktrees, and verify that other checkouts and historical outcomes remain readable.