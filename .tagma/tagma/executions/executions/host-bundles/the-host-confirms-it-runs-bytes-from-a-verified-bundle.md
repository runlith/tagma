---
id: 01a0c725-c7d3-747e-b8fe-938a20b0d091
title: The host confirms it runs bytes from a verified bundle
ord: 2
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: dir
    ref: packages/executions
  - kind: symbol
    ref: packages/executions/src/hostArtifacts.ts
    symbol: boundTo
  - kind: symbol
    ref: packages/executions/src/hostArtifacts.ts
    symbol: verifyArtifact
---
The caller holds the used path and checks runtime, entry and library through boundTo, comparing the declared and used real paths; directory verification never proves that.
