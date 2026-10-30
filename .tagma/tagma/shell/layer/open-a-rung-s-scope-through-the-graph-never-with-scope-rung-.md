---
id: 01a0c710-39e7-7b3d-a988-80be744082a4
title: Open a rung's scope through the graph, never with `Scope.rung` directly
ord: 27
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/layer/src/Scope.ts
    symbol: rung
  - kind: file
    ref: packages/layer/src/Graph.ts
---
`Scope.rung` only creates and links a child scope; the graph computes the scope's place and opens it with the rung's `Current` value and its providers.