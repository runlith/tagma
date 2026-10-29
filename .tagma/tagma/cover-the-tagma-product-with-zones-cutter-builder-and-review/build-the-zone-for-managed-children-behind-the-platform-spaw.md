---
id: 01a0c6f2-a8ef-76eb-91b1-302457b8c17c
title: Build the zone for managed children behind the platform spawner
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c70f-0a0f-7ee7-96ab-e1bb2c7b7d08",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/executionSpawner.ts
  - kind: file
    ref: packages/executions/src/ManagedCall.ts
---
Write the claims of [[556cf493]] from `packages/executions/src/executionSpawner.ts` (1029 lines, the largest file in the package) and `packages/executions/src/ManagedCall.ts`. Parent [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The port it calls is [[1e4f52e0]]; the environment it resolves is [[d1324b4c]]; the cost it reads is [[f33ef6e4]].

A claim that the platform contract is held WHOLE, or that something is refused rather than approximated, is written only after reading each branch that answers such a request. Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.