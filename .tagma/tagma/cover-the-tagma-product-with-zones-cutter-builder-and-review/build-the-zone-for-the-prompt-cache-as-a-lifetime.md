---
id: 01a0c83e-727a-7edb-a647-b4301e7304c5
title: Build the zone for the prompt cache as a lifetime
ord: 113
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c883-7a77-70bd-a2ff-e41a79610169",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/cache-policy.ts
  - kind: file
    ref: packages/llm/src/models/cacheLifetime.ts
---
Write the claims of [[b1b7c13d]] from those two files. Parent [[249ce587]], reference shape [[6c81c6f3]]. What a gap bucket is measured from, and what a cache hint on a request obliges a protocol adapter to do with it.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.