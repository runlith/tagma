---
id: 01a0c6e3-56d5-75c5-801e-a07d604d061a
title: Cut packages/executions into its module and areas
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6e6-c3c4-77c5-a668-f609ad70697b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/executions
---
Wave 0, cutter: `packages/executions` (36k lines, 108 files) is cut by `zone-cutter` into module, areas, depends-on edges and boundary claims; the cutter opens one task per area under the decision.