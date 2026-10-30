---
id: 01a0c84b-5b6d-782c-aa9f-aaff93e27bf4
title: Whoever mounts the segment ring keeps the list of open retention groups it passes to `maintain` truthful
ord: 19
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/performance/drizzle
  - kind: file
    ref: packages/performance/drizzle.config.ts
  - kind: file
    ref: packages/performance/src/schema.ts
  - kind: file
    ref: packages/performance/src/SegmentCatalog.ts
  - kind: file
    ref: packages/performance/src/SegmentRing.ts
  - kind: symbol
    ref: packages/performance/src/SegmentRing.ts
    symbol: groupFloor
  - kind: symbol
    ref: packages/performance/src/SegmentRing.ts
    symbol: maintain
---
The ring cannot tell a finished group from an abandoned one: a group left in the list keeps its segments from eviction, one missing from it lets them be evicted.