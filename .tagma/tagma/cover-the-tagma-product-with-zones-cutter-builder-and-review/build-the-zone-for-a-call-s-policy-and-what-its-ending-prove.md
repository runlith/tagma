---
id: 01a0c6f2-a7b2-7d31-b497-5b05ea347e1c
title: Build the zone for a call's policy and what its ending proved
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6fd-40b0-753b-a697-9807ea3091e8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/call.ts
  - kind: file
    ref: packages/executions/src/protocol/stop.ts
---
Write the claims of [[a7aaa10f]] from `packages/executions/src/protocol/call.ts` and `packages/executions/src/protocol/stop.ts`. Parent [[fd73da27]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]].

Check what the evidence establishes rather than what the code attempts: a signal request is not an exit and a leader's exit is not the absence of its descendants. Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.