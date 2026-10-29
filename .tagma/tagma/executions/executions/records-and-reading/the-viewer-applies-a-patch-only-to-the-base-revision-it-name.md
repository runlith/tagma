---
id: 01a0c70a-8490-7de7-8a0d-8bd2a6da66cc
title: The viewer applies a patch only to the base revision it names
ord: 3
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/presentationPaint.ts
  - kind: symbol
    ref: packages/executions/src/protocol/presentationPaint.ts
    symbol: PatchBase
  - kind: symbol
    ref: packages/executions/src/protocol/presentationPaint.ts
    symbol: presentationEncodePatch
---
A viewer with no base revision history requests a full frame.
