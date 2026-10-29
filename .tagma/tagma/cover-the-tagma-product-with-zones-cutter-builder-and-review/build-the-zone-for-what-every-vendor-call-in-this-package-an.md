---
id: 01a0c83e-7290-7f7d-a746-562fca55532c
title: Build the zone for what every vendor call in this package answers to
ord: 116
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c87c-7ec7-7923-8a7a-de89bc98bd58",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/redact.ts
  - kind: file
    ref: packages/llm/src/vendorCall.ts
---
Write the claims of [[2a96ffaf]] from those two files. Parent [[249ce587]], reference shape [[6c81c6f3]]. [[b7fbf4a3]] and [[dda7508d]] already state how each figure reaches the package's owners — claim instead what the redaction actually catches and what it cannot: the minimum secret length, the anchored short query names, and what survives in a body a vendor spelled differently. The comment at the head of `vendorCall.ts` calls the figure the executor's ceiling on a provider wait; the code does not do that, so do not repeat it.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.