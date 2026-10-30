---
id: 01a0c71c-fb21-73ea-83fa-b0482e6ca9eb
title: An empty list of processes or listeners means "none" only when its completeness is `complete`
ord: 3
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: EvidenceCompleteness
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: UnmeasuredRegion
---
With `partial` or `unavailable` the measurement did not reach part or all of the population; read `unmeasured` for which regions.