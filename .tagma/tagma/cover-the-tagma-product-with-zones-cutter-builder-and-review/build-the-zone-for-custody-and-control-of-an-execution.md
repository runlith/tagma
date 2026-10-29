---
id: 01a0c6f2-a7b9-7c83-99d7-559b099f9512
title: Build the zone for custody and control of an execution
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6fd-4173-77d2-aa3b-5c6a8403beb0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/control.ts
  - kind: file
    ref: packages/executions/src/protocol/custody.ts
---
Write the claims of [[fcb35f72]] from `packages/executions/src/protocol/custody.ts` and `packages/executions/src/protocol/control.ts`. Parent [[fd73da27]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. Host-level custody is a different subject and lives in [[cb53db9b]].

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.