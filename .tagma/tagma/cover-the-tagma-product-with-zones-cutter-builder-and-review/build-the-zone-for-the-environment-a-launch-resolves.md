---
id: 01a0c6f2-a903-764f-b60a-58ade9826e27
title: Build the zone for the environment a launch resolves
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c716-eff9-7345-b460-0207323e1906",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/executions/src/CommandEnvironment.ts
---
Write the claims of [[d1324b4c]] from `packages/executions/src/CommandEnvironment.ts`. Parent [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The launch record it resolves into is [[9f386482]].

The ordering rule — which entry a caller can overrule and which it cannot — is the claim that carries this area. Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.