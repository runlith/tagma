---
id: 01a14c68-7621-72a2-934f-b3d113fa5d17
title: A live graph tree's refresh reads status only on the paths the watcher named
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea99-75cf-80ea-5e561320d6d3",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14c5a-4c1f-719c-8aa5-3b838d8a01b6
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/freshness.ts
    symbol: treeSeen
---
The live part of step 3 of the [[8d8a01b6]] spec. `FreshnessGate.refresh` now calls `readTree` → `treeSeen` with the graph tree's full status on every watch and throws the watcher's paths away. The gate piles the named paths since the last refresh; a refresh with them takes a status on a literal pathspec (the command-line bound as in `workspace/checkouts/comparison.ts#fitsCommandLine`) and compares HEAD against the stamp. A full status stays for the first read, `unnamed`/reset, bound overflow, and a `.gitignore`/`info/exclude`/`core.excludesFile` change.

Start with `graph/serving/freshness.ts` and `graph/tree/freshness.ts`. Proof: the spec's acceptance 6 (a one-path refresh span) and the freshness contract tests (`graph/tree/freshnessMatrix.itest.ts`).
