---
id: 01a0c70a-8490-7de7-8a0d-8bd2a6da66cc
title: Apply a screen patch only to the base revision it names; with no such revision, ask for a full frame
ord: 3
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/protocol/presentationPaint.ts
    symbol: PatchBase
  - kind: symbol
    ref: packages/executions/src/protocol/presentationPaint.ts
    symbol: presentationEncodePatch
---
A patch applied to any other revision leaves the viewer's screen wrong.