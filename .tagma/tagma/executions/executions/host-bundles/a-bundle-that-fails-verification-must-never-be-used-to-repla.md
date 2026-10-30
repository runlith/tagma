---
id: 01a0c726-8699-7fd8-8773-900117dfab90
title: A bundle that fails verification must never be used to replace the host already standing at the address
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
The standing host keeps running until a verified successor is ready.