---
id: 01a0e532-cd64-7768-8533-d82bcb39fb3f
title: "http M1: contract and runtime ready"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0eaeb-8280-79e2-834d-8efa354b0c0d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c833-7e69-8475-95bc0f489891
  - kind: waits-on
    to: 01a0e532-cd3f-7b6c-9add-c2ccefbe85a5
---
§7.2.2 milestone `M1` of the `http` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]]. `FreshnessGate.ts` and `MirrorBuilder.ts` still import sqlite-process's write marker directly. Replace both with the graph-branded `GraphUnits.markWrite` member; `FreshnessGate` obtains units from the served graph context after resolving it, while `MirrorBuilder` uses the graph units its machine context holds. Neither marker opens a transaction.