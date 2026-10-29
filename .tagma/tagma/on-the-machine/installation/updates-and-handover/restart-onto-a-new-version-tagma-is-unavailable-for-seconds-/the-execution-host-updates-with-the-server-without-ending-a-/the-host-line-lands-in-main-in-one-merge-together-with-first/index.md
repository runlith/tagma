---
id: 01a12735-55f2-75e0-95d7-53127c1b6811
title: The host line lands in main in one merge together with first enablement
ord: 14
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
  - kind: waits-on
    to: 01a1271e-2479-7971-9b0c-4ecea06a1a9e
  - kind: waits-on
    to: 01a127af-c14d-7f11-84ef-57d12da7ead3
sources:
  - kind: dir
    ref: apps/tagma/server/src/executions/host
  - kind: dir
    ref: packages/execution-host
---
The host line lands in main in one merge together with first enablement. The line worktree is created from main at the start of work on [[e946bdd8]]; all line tasks land in it. Before the merge the worktree updates from main, and line system tests, the [[212d752c]] stand with a host change, and the [[a06a1a9e]] first-enablement run pass on the final tree. The merge is one, through `merge_worktree`; two host forms never sit beside each other in main. Proven: the merge landed, and the main build after it takes its place from the server and host of the pre-line main build on one's own instance.
