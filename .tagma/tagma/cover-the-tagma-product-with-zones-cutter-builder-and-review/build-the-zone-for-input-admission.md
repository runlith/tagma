---
id: 01a0c6f2-a7c1-7c47-a0ea-0d9fa7b6be28
title: Build the zone for input admission
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6fd-42d8-7948-9787-c8128fc2edf2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/input.ts
  - kind: file
    ref: packages/executions/src/protocol/inputProfile.ts
---
Write the claims of [[de5cd9ca]] from `packages/executions/src/protocol/input.ts` and `packages/executions/src/protocol/inputProfile.ts`. Parent [[fd73da27]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]].

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.