---
id: 01a16b11-a77b-79e3-a167-9b598e8f8477
title: "bodies.test.ts misses the 1000 ms test timeout: it loads every operation body inside the test"
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16aff-9b7d-7228-ba5b-5d2b0c2de9a6
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/operationCatalog.test.ts
---
`apps/tagma/server/src/composition/bodies.test.ts`, test "every declared operation loads one body, filed under its own id", times out under the machine's load on 2026-10-24: 1004–1005 ms against 1000 ms, file CPU 1835 ms. The test loads every operation body inside its own body; that is the same cold-build cost [[0c2de9a6]] removed from `handles.test.ts` and `places.test.ts` with a shared `operationCatalogLayer` in `beforeAll`. Found while verifying the fix for [[d87d020b]].
