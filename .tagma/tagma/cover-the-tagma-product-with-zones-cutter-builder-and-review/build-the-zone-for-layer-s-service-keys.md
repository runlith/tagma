---
id: 01a0c702-181e-7f19-834d-2e44c548e464
title: Build the zone for layer's service keys
ord: 52
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c705-d6e8-7a9e-8329-03cf45e141ce",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/key.ts
  - kind: file
    ref: packages/layer/src/process.ts
---
Fill [[85c3aeb1]] with the claims its code establishes. Read `src/key.ts` and `src/process.ts` whole, with `src/process.test.ts` for the behaviour the grammar promises; the tier vocabulary and the `Ladder` augmentation live here, the rungs that fill it in [[29621528]]. Watch the distinctions a reader cannot infer: what tells a key that declares no recipe from one that does, what the two doors of a deferred key answer, and why a synchronous `yield*` of such a key hands over a handle rather than the instance. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].