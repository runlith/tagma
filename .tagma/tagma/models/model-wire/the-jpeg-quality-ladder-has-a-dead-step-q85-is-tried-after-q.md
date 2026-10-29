---
id: 01a0c8cb-04a7-74ef-ac07-ae140892f3d8
title: "The JPEG quality ladder has a dead step: q85 is tried after q80 has already failed the ceiling"
ord: 47
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/llm/src/models/normalizeModelImage.ts
    symbol: JPEG_QUALITIES
---
`JPEG_QUALITIES = [80, 85, 70, 55, 40]`. Measured on noise, q85 output (3215 B) exceeds q80 (2896 B), so once q80 has failed the byte ceiling the q85 attempt cannot succeed — it is a wasted encode on every reduction that gets that far. Inherited unchanged from the pre-extraction file, like the other four figures ([[a4737a06]]).