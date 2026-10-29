---
id: 01a14c4d-cda2-74ec-95aa-e21cc871e706
title: Finish the Effect migration of workspace tools and file measurement
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c18-57a4-7e44-8b73-f191092d229d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
sources:
  - kind: file
    ref: packages/agent-tools/src/bash/tool.ts
  - kind: file
    ref: packages/agent-tools/src/changed.ts
  - kind: file
    ref: packages/agent-tools/src/CheckoutBaselines.ts
  - kind: file
    ref: packages/agent-tools/src/commandWork.stest.ts
  - kind: file
    ref: packages/agent-tools/src/delete.ts
  - kind: file
    ref: packages/agent-tools/src/localLadder.ts
  - kind: file
    ref: packages/agent-tools/src/rename.ts
  - kind: file
    ref: packages/agent-tools/src/runtimeSpawner.stest.ts
  - kind: file
    ref: packages/agent-tools/src/write.ts
---
Finish the manual Effect migration of file and shell act preparation, clocks and owner tests. Newline normalization on Git error refuses before writing; unreadable fingerprints stay unknown and keep the cause. Long real process probes belong to the system layer. Proof is package types, covering owner tests, scoped inspections and one independent review, including the unknown-to-final-verdict chain.
