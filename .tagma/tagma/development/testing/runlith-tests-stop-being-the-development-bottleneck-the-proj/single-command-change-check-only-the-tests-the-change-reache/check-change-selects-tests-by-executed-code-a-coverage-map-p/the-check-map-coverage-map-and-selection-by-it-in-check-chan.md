---
id: 01a17d59-ec17-7df5-b790-3823cfc750ae
title: The `check:map` coverage map and selection by it in `check:change`
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16e20-3dd6-7696-901e-d29696ccb336",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17d59-bc14-715f-8f98-e74051be9c36
sources:
  - kind: dir
    ref: scripts/change
---
Build what the spec describes: map storage in the `check:change` cache, the `check:map` command (a process per file through testbed with lcov), and `check:change` selection narrowing by the map, with reasons. Prove at a scale that fits the command's life; full coverage waits on the operator's command-life decision.
