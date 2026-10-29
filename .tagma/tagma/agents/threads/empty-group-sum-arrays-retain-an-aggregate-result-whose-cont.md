---
id: 01a0cac7-2b50-78b5-ad2b-765aded36341
title: Empty group/sum arrays retain an aggregate result whose continuation refuses stale
ord: 87
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/service/evidence.ts
    symbol: EvidenceReads
---
The kernel's `grouped()` counts `group: []` and `sum: []` as grouped (presence alone), while `EvidenceReads.wholePopulation` requires non-empty arrays. Validation tolerates the empty arrays, so such an aggregate is retained as a result — and its result-stop then refuses stale at `admitStop`, since the pin's question 'does not produce' one. The first page answers; the second cannot continue.

Done when empty group/sum arrays either refuse at the shape gate or count the same on both sides of the retain/continue line — proved by a test paging an aggregate asked with an empty array.