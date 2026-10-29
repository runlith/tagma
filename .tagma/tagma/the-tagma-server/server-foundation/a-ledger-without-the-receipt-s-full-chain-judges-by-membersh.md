---
id: 01a1318a-45eb-7b90-ad41-e7d9a6cf2de3
title: "A ledger without the receipt's full chain judges by membership: a skip means \"base not reached\", only a foreign row corrupts the chain"
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/storage/baseline.ts
  - kind: symbol
    ref: apps/tagma/server/src/platform/store/baseline.ts
    symbol: foldedCut
---
The former chain applied migrations by name. A migration landed later with an earlier time leaves a skip in the ledger of a store that already passed its successor. Building to the base would have written it in, so such a store simply never reached the base. The main store refuses `BaselineNotReached`: a former build opens it first. A graph mirror below the base mark is recreated on open from the tree files: its journal, trash and snapshots are lost; an incomplete chain alone never corrupts the tree files.

That the applied chain was rewritten is proven only by a row outside the receipt, a foreign hash or a repeat. Then `MigrationChainInvalid`, and the mirror stays on disk. Same-time group positions and schema fingerprints reconcile only when the ledger holds the whole chain: then it decides whether to fold it into the base row.
