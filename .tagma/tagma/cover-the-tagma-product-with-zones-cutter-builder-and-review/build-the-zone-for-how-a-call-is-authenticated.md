---
id: 01a0c83e-722f-7fcf-bbff-ce59da59f820
title: Build the zone for how a call is authenticated
ord: 102
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c86a-0348-700d-b584-3966e7add08a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/route/auth-options.ts
  - kind: file
    ref: packages/llm/src/llm/route/auth.ts
  - kind: file
    ref: packages/llm/src/profiles/credential.ts
---
Write the claims of [[5d55b7bf]] from those three files. Parent [[249ce587]], reference shape [[6c81c6f3]]. The package owns no credential: when a credential is fetched relative to the request, and which refusals of a product's source survive into the call's own failure and which are flattened.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.