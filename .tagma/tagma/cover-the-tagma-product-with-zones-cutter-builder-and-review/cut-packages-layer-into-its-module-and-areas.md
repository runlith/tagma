---
id: 01a0c6f6-d5b6-78d0-94f1-4c3bc99cf964
title: Cut packages/layer into its module and areas
ord: 51
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6f7-7fca-7715-ae50-fe639d666888",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/layer
---
Wave 0, cutter: `packages/layer` (4,866 tracked non-test lines, 84 files) — the application graph without a runtime; a leaf by manifest. The cutter opens one task per area.