---
id: 01a1767f-3865-76b8-a30e-3b51b70bbee7
title: A slice cuts a surviving block when the shortest diff replaces folding anchors with a move across equal brackets
ord: 74
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17649-5aac-796f-b4a0-9033e9160ee2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17648-cb2e-75fc-b4e3-abd0dfcaaf81
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/net.ts
    symbol: netOf
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: transferredBy
---
When every block before a surviving block is deleted and new ones are inserted after it, `netOf` does not hold the folding anchors: the shortest diff cheaper pairs the closing brackets, the surviving block comes out deleted and re-inserted, and `transferredBy` hands that move to the last intersecting writer. The session slice then tears the surviving block's header and body from its `}`, though nobody touched that block.

Example (block-fuzz, seed 490, functions): base n0, n1, n2, n3; A deletes n1 and appends n4 at the end; B appends n5 at the end and deletes n0; C deletes n2 and inserts n6 before n5. Slices C and B break n3.

Measurement after fixing the slice on shortened pairs ([[bf2012e8]]): 5 broken first landings out of ~9000 (3000 cases × 3 landing orders), all of this kind; before the fix there were 2066.

Direction: where `netOf` replaced folding-anchor windows with minimum windows, slice on the folding alignment — surviving lines stay HEAD lines for any slice — not on the shortest-diff move.
