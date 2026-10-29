---
id: 01a0c6f2-a8ba-7e93-b736-f4555c26d00c
title: Build the zone for what one connection holds open
ord: 28
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c70a-71c8-7638-a136-2d24b4089c76",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/WireReaders.ts
  - kind: file
    ref: packages/executions/src/WireRequests.ts
---
Write the claims of [[fb25686f]] from `packages/executions/src/WireRequests.ts` and `packages/executions/src/WireReaders.ts`. Parent [[ca298040]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. That neither file has a door in the manifest is already claimed at the module.

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.