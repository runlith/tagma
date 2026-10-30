---
id: 01a0cacc-8c1e-71ee-b3ef-a5351e4a8f0d
title: A worktree act that reads the world and then settles reads first, then opens its own units, and never starts inside an open unit
ord: 2
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/worktrees
---
A verb that only settles takes the caller's unit and never touches the disk: reading the world inside that transaction would hold the store's only writer.