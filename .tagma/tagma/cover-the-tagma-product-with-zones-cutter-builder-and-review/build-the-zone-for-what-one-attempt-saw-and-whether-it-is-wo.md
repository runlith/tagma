---
id: 01a0c83e-7226-7b49-9ebc-a73c49cc65d4
title: Build the zone for what one attempt saw, and whether it is worth another
ord: 101
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c86a-0257-7a81-b75e-8fabeb7f7fc5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/llm/src/llm/route/executor.ts
  - kind: file
    ref: packages/llm/src/llm/route/liveness.ts
  - kind: file
    ref: packages/llm/src/llm/route/ModelRetryPolicy.ts
  - kind: file
    ref: packages/llm/src/llm/route/refusal.ts
  - kind: file
    ref: packages/llm/src/llm/route/wireReading.ts
---
Write the claims of [[ea0876c3]] from those five files. Parent [[249ce587]], reference shape [[6c81c6f3]]. Why the stall is measured on frames rather than on events, what the backoff ladder is bounded by, and what a `Retry-After` above that bound does — [[b7fbf4a3]] already states how `VENDOR_CALL_TIMEOUT_MS` is spent here, so do not restate it.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.