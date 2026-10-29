---
id: 01a0c6f2-a88c-76c7-9710-f11c9462e8f7
title: Build the zone for what a client learns about a host without running anything
ord: 23
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c74f-c90e-79fb-b5e5-be9a6c18d89a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/artifact.ts
  - kind: file
    ref: packages/executions/src/protocol/family.ts
  - kind: file
    ref: packages/executions/src/protocol/registration.ts
---
Write the claims of [[cb53db9b]] from `packages/executions/src/protocol/registration.ts`, `artifact.ts` and `family.ts`. Parent [[fd73da27]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The owners that act on these records are [[f7491edf]] and [[677b406f]]; read them and leave their claims to their own tasks. That the package measures no import order, and why `family.ts` stands alone, is already claimed at the module.

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.