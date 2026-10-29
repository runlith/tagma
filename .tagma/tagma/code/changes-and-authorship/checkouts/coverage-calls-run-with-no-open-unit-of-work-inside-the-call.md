---
id: 01a0caaf-4934-71d9-a9df-5e6aaf0ec52d
title: Coverage calls run with no open unit of work; inside the caller unit only the reservation completes
ord: 1
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph/projects
  - kind: symbol
    ref: apps/tagma/server/src/workspace/roots/coverage.ts
    symbol: makeCoverageLedger
---
Order: fetch the environment, admit, on refusal reconcile, then reserve.
