---
id: 01a13cd6-ce89-709d-b6eb-a5bdae741f83
title: "rankingMatrix and history itests fail under parallel load: per-block creation timeout and wall-time threshold"
ord: 48
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c96-169d-7590-9735-bcaf64ef0ba3
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/history.itest.ts
  - kind: file
    ref: apps/tagma/server/src/graph/core/rankingMatrix.itest.ts
---
Two graph-module integration tests fail under a parallel run (`bun test --parallel=3` at load average ~15–27) and pass alone (2 of 2):

- `graph/core/rankingMatrix.itest.ts` "a figure past the ceiling is cut at the ceiling the family derives" — creates `ceilingOf(BLOCKS) + 10` blocks one by one through `make`, and never fits into the test timeout under load.
- `graph/blocks/history.itest.ts` "a 200 KB rewrite is diffed and rendered within a bound" — compares `bodyDelta`/`mergedMarkdown` wall-time against a threshold; under CPU contention the threshold breaks.

Fixed in `89324bff30` (history) and `448612e06d` (rankingMatrix and the acquisition fixture). History keeps the roundtrip, delta compactness, and render correctness without wall-time thresholds; 16 tests passed. Ranking uses a minimal corpus of `ceilingOf(BLOCKS)+1`, one bulk insert of copies of the real seed, and public projection restore; seed/bulk parity, tier order, ceiling, and total are checked. The cold template build runs in the layer's acquisition before the first test body. A parallel run of the eight affected files gave 47 pass / 0 fail; later merges of the two files kept all assertions and passed separately. A single run of the whole module and statistical stability under varying load are not proven.
