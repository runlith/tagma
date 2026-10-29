---
id: 01a0c702-1835-7631-9f4b-73ff7c9db220
title: Build the zone for layer's layers
ord: 53
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c705-da0e-7227-80d4-8db3049a43c2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/Layer.ts
---
Fill [[a284f0f8]] with the claims its code establishes. Read `src/Layer.ts` whole, with `src/member.test.ts` for the registry member. Watch: why one item per key class makes a bare key arriving from two directions reuse rather than a second provider, why a condition names the keys it reads outside itself, why a registry member is one key and no more, and what the phantom type carries. The module already states the limitation this file causes at the closure check — [[3b305728]] — so qualify rather than restate it. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The module is [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].