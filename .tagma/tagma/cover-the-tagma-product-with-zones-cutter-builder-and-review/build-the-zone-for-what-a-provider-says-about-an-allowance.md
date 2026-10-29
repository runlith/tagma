---
id: 01a0c83e-7213-7e9e-94a1-193b3d65fe0e
title: Build the zone for what a provider says about an allowance
ord: 98
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c853-2d1b-76f9-91ba-10aaa2ad0bad",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/schema/quota.ts
  - kind: file
    ref: packages/llm/src/profiles/quotaRead.ts
---
Write the claims of [[c4610c8e]] from `packages/llm/src/llm/schema/quota.ts` and `packages/llm/src/profiles/quotaRead.ts`. Parent [[249ce587]], reference shape [[6c81c6f3]]. Two sources of one observation — a reply's headers and a usage endpoint — and what each failure of a quota read means for the call that was going to be made anyway.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.