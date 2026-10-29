---
id: 01a159b0-0c98-7d80-bda9-ae10b891b1e3
title: "Build edges between projects: graph-root address in the block file, far_edge and phase words in the mirror, ForeignBlocks, blocked and held in ready_work, readings and the links screen"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a159a1-5659-786f-8088-acd20618c9aa",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a159ae-2c87-7eea-be0d-532f4476383d
---
Implements [[4476383d]] whole, except links and project removal. Start with the `graph/tree/blockFile.ts` codec and tree reading in `graph/tree/mirror.ts`, then `ForeignBlocks` in `graph/serving`, the `blocked` measurement, `link_blocks`/`unlink_blocks`, readings, and `BlockPage`. Proof is the two-project integration tests from the spec's "Acceptance" section.
