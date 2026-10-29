---
id: 01a0c726-8699-7fd8-8773-900117dfab90
title: A failed verification never permits replacing the host standing at the address
ord: 3
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
    symbol: ArtifactInvalid
  - kind: symbol
    ref: packages/executions/src/hostArtifacts.ts
    symbol: verifyArtifact
---
