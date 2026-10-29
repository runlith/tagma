---
id: 01a0c85e-a273-7e70-9bb6-7be1734e14d5
title: Remove or wire `workerDrops`, an exported empty counter in the performance worker that nothing reads
ord: 35
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: packages/performance/src/store/worker.ts
    symbol: workerDrops
---
`worker.ts:253` exports `const workerDrops: LossKindCounts = {}` — an empty object that a repo-wide grep over `apps/` and `packages/` finds referenced nowhere, named by no door of the package and read by no test. It is not a boundary question: [[c3f5444c]] is about what the worker side exposes through the package's doors, and this export reaches none of them.

Either it is the remains of a drop-accounting path that moved into the catalog's own counters, in which case it goes; or something outside this checkout imports it, in which case that consumer names what it is for. Start at the symbol and at the drop accounting that replaced it — the catalog's `drops` and `addDrops`, which are where a worker's losses are now counted.

Done when the export is gone, or when it carries a reader and a claim saying what it answers.
