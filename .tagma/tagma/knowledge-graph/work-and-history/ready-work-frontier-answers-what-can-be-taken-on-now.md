---
id: 01a14bc5-0df5-77c8-b1a2-693d15f0c397
title: Ready-work frontier answers what can be taken on now
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692e4ad9de5e
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69369c55efea
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693cdef49593
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/acts/measurement.ts
    symbol: measuredCondition
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/work.ts
    symbol: WORK_READ_PAIRS
  - kind: symbol
    ref: apps/tagma/server/src/graph/search/selection.ts
    symbol: readyFrontier
---
**Value.** An agent or the operator learns in one call what can be taken on now: open work held back by nothing.

**How.** `ready_work` by project or subtree. In the app — a "ready" filter in outline and on the map and a lock sign on the row; in the project overview — a frontier row.

**Behaviour.**
- The frontier holds unstarted, unreplaced work whose every waits-on blocker is already finished or replaced. A blocker in the trash also stops blocking.
- Order runs from older work to newer. The answer names the full frontier count, so what did not fit the page is not lost.

**Limits.** Work in progress never enters the frontier: the overview shows it.
