---
id: 01a0c702-1842-79c5-a23b-b92188f4e09e
title: Build the zone for layer's settings keys
ord: 55
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c705-e299-7320-b9bb-cdfaa45d3298",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/config.ts
---
Fill [[b30754d9]] with the claims its code establishes. Read `src/config.ts` whole, with `src/config.test.ts`. Watch: what the static `read()` door gives up in exchange for answering with no app mounted, why an absent string and a published empty one say the same thing, the order a brand's own defaults and a payload are merged in, and what each field parser refuses. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].