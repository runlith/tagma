---
id: 01a0c718-07e8-7d65-a93e-4e110f68fc1e
title: Continue an inventory listing with the `after` watermark the previous page returned, unchanged
ord: 7
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/protocol/inventory.ts
    symbol: CommandWatermark
---
The watermark carries the query's filters with the last entry's position; building one by hand can skip or repeat entries.