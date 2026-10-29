---
id: 01a0c6f2-a7f6-7d19-8537-49e8076d0a1a
title: Build the zone for the interpreted screen as a record
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6fd-4561-75ad-a942-7466950fbcd1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/protocol/appearance.ts
  - kind: file
    ref: packages/executions/src/protocol/presentation.ts
---
Write the claims of [[48f0093b]] from `packages/executions/src/protocol/presentation.ts` and `packages/executions/src/protocol/appearance.ts`. Parent [[fd73da27]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. Its three parts — [[92d2dca7]], [[eb4aec7b]] and [[44b6458b]] — own their own files and have their own tasks.

Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.