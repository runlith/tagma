---
id: 01a0e532-cd7b-73a4-b334-e45a242596cd
title: "http M3: closed"
ord: 3
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
    to: 01a0e532-cd6e-7a04-85b9-0ab5dd5ad950
---
§7.2.2 milestone `M3` of the `http` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

Divergence: integration tests were not run in this wave (typecheck filtered to http and the http unit tests only); the typed route groups named on [[dd5ad950]] remain as their owners' debt.