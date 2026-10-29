---
id: 01a0c702-18ec-7949-8ffb-872459c55786
title: Build the zone for layer's cookies on the wire
ord: 62
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c713-27d9-7346-b29f-beb6279d8706",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c700-4cde-7cce-8b46-dc3859cc3c49
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/layer/src/cookies.ts
---
Fill [[1f6ad744]] with the claims its code establishes. Read `src/cookies.ts` whole, with `src/cookies.test.ts`. Watch: which prefix carries which invariant and what each refusal prevents a caller from shipping silently; why `SameSite=None` and a partitioned cookie both require `Secure`; what the two length caps are measured against; and why a value that fails to decode is returned as it stands. Every claim hangs under that area, bound to the narrowest sources that can contradict it and verified after a reading of all of them. Done when the area's body is corrected wherever the code contradicts it, `run_doctor` over its paths leaves nothing open, and a review passes. The parent area is [[be347c19]], the module [[59cc3c49]]; the reference shape is the Git kit [[adeeb4ba]].