---
id: 01a0c83e-7219-735c-9d48-5abffb732d65
title: Build the zone for the route a call takes
ord: 99
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c843-49c4-7bdb-afe0-423ec3aacae8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/llm/src/llm/route
  - kind: file
    ref: packages/llm/src/llm/origin-policy.ts
---
Write the claims of [[133c03a6]] from `packages/llm/src/llm/route` (its children [[e8f0056e]], [[ea0876c3]] and [[5d55b7bf]] own the transports, the attempt and the auth — leave those files to them) and `packages/llm/src/llm/origin-policy.ts`. Parent [[249ce587]], reference shape [[6c81c6f3]]. What a route binds, what the client owns of a call versus what the protocol owns, and what the origin check actually refuses.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.