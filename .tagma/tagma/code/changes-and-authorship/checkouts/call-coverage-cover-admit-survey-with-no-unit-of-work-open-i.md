---
id: 01a0caaf-4934-71d9-a9df-5e6aaf0ec52d
title: Call `Coverage` (`cover`, `admit`, `survey`) with no unit of work open; inside the caller's unit only the root reservation runs
ord: 1
tags: ["rule"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/roots/coverage.ts
    symbol: makeCoverageLedger
---
Coverage opens its own units. Order: fetch the environment, admit, on refusal reconcile, then reserve.