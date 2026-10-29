---
id: 01a0c702-1865-759a-8b07-75e4508732c7
title: Build the zone for layer's kernel
ord: 56
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c711-6f1d-73f5-b847-8e121db99e63",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/Graph.ts
---
Fill [[10a5fc73]] with the claims its code establishes — the largest area of this module at 667 lines. Read `src/Graph.ts` whole, with `src/svelte/chunk-conditions.svelte.test.ts`, `src/svelte/deferred.svelte.test.ts` and `src/svelte/flagged-feature.svelte.test.ts` for the conditional and chunked behaviour. Watch: where a conditional layer's key is filed and why filing it above the scope that admitted it is refused; what a failed chunk fetch deliberately does not cache; what a withdrawn condition ends and what it leaves; why a scope not yet started builds nothing eagerly; which refusals prove what; and that each error class is named by the one condition that raises it. Read this area's vocabulary first: [[85c3aeb1]], [[a284f0f8]] and [[160f3270]]. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].