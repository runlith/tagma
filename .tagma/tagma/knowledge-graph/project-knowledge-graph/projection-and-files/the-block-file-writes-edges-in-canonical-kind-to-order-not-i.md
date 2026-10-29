---
id: 01a1314e-8679-78ae-aa9f-d529209d36cc
title: The block file writes edges in canonical (kind, to) order, not in mirror-row order
ord: 3
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/blockFile.ts
    symbol: blockFrontmatterOf
---
The row order of `edge` returned by SQLite depends on the mirror's internal ids, and each branch has its own mirror. Without sorting, the same block projected on two branches differs only in edge order, and merging their graph trees in git conflicts on equal edge sets: 13 proposals conflicted this way in one project.
