---
id: 01a14c37-8e7b-74e3-8e1c-8bf937c03b0a
title: Show how much space a worktree takes and how much of it can be freed
ord: 1
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d3421798ba
---
The `space.scan` feed (worktrees/space) already measures a worktree's disk and freeable ignored files, but neither a screen nor an agent tool calls it.
