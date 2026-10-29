---
id: 01a0c6f2-a912-723b-bf33-224909e2bac9
title: Build the zone for the host conformance definition
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c710-ea2a-7e79-a85a-1354ed30356a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/executions/src/conformance
---
Write the claims of [[3266ae64]] from `packages/executions/src/conformance`. Parent [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]]. The port it drives is [[1e4f52e0]]; the profile it takes its limits from is [[361d0b15]].

What passing this definition does and does not establish about an implementation is the claim worth the most here. Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.