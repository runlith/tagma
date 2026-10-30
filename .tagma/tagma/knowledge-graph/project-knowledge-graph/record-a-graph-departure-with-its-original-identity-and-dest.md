---
id: 01a18a43-bbb0-7188-8682-75a17cfa7395
title: Record a graph departure with its original identity and destination
ord: 253
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15eb-7a51-a5e5-7575ca9c9ee7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1823f-c8da-7004-933e-00d65a397826
---
Make cross-project block moves record a departure rather than a deletion under a minted trash identity. Keep the moved block's original name and target graph in the source journal and graph commit, with a public-door regression covering the move.