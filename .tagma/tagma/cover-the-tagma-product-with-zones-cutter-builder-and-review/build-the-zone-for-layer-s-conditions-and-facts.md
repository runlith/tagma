---
id: 01a0c702-183d-7d9d-a85f-fdd26a49bf13
title: Build the zone for layer's conditions and facts
ord: 54
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c705-dfaa-7be2-bbe2-a753e11ffb72",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/condition.ts
---
Fill [[1fac647e]] with the claims its code establishes. Read `src/condition.ts` whole, with `src/svelte/condition.svelte.test.ts` for how a watched condition behaves. Watch: why a latch that was never true holds nothing up, what the held-until moment is for a reader scheduling its next pass, and why an instance-bound fact declares the app tier. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].