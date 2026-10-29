---
id: 01a0c83e-7296-75dc-b945-71ef7b26ab71
title: "Build the zone for what a selection becomes: the deployment profiles"
ord: 117
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c843-4cca-7afd-b60d-bcdda56ab61c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83b-81fb-7929-bac8-0429249ce587
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/llm/src/profiles
---
Write the claims of [[f33ce48e]] from `packages/llm/src/profiles` — the profile contract, the ordinary registrations, the reasoning lowering and the composed default list; its children [[15c31176]], [[3b3ba07a]] and [[bf5b1dbc]] own the disguise, the Claude Code deployment and the Devin agent. Parent [[249ce587]], reference shape [[6c81c6f3]]. The credential interface's laziness and what `MODEL_EGRESS_ORIGINS` is derived from are the claims worth the most; [[2062b6ac]] already states what the direction table does and does not fence.

Done when every invariant and limitation of this concern stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over these paths leaves nothing open, and a review passes.