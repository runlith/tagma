---
id: 01a0c702-187d-7bd9-8b51-6dc392c6cd12
title: Build the zone for layer's ladder of rungs
ord: 58
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c706-7508-7016-bf1a-b3e4e50ae696",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/Rung.ts
---
Fill [[29621528]] with the claims its code establishes. Read `src/Rung.ts` whole, with `src/svelte/ladder.test.ts`, `src/svelte/screen-tier.test.ts` and `src/ladder.test.d.ts`; the fixture ladder a test stands on is in `src/testing.ts`, owned by [[33d7f6dd]]. Watch: why a scope's place has to be injective and what is escaped to keep it so, why a rung answering a kind must list its kinds, what a rung name may not contain, and what the invalidation dependency is for. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].