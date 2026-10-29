---
id: 01a0c8cb-04a3-7279-a0d1-08e01609f9ad
title: Image reduction drops EXIF orientation without applying it, so a portrait photo can reach a model landscape
ord: 44
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/llm/src/models/normalizeModelImage.ts
    symbol: normalizeModelImage
---
Measured with a live probe against sharp 0.34.5: an 8x4 input declaring orientation 6 comes out an 8x4 PNG with the tag gone and the rotation never applied, so it now displays unrotated. Reduction names no rotate, frame or metadata option, leaving all three to sharp's defaults ([[4b88e55c]]) — which also means animated input reduces to its first frame.

Only the reduction path is affected; an image already under every ceiling passes through byte-identical.