---
id: 01a0c702-186f-7fe5-8142-b1cfc42d8649
title: Build the zone for layer's scopes
ord: 57
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c706-7385-75c9-856e-1bdefa8c22fc",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/clock.ts
  - kind: file
    ref: packages/layer/src/Scope.ts
---
Fill [[160f3270]] with the claims its code establishes. Read `src/Scope.ts` and `src/clock.ts` whole, with `src/Scope.test.ts`. Watch: why a tierless scope hosts nothing and what that makes of a lookup through it; what `collect` gives a service that the scope alone would not; why a finalizer registered after the close runs at once; what a failing finalizer does to the close; and which scope mints are the graph's alone. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].