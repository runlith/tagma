---
id: 01a0c6f2-a813-7192-a13f-82551a6d3415
title: Build the zone for glyph width agreement between the two engines
ord: 17
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
    ref: packages/executions/src/protocol/zwjWidths.ts
---
Write the claims of [[44b6458b]] from `packages/executions/src/protocol/zwjWidths.ts`. Parent [[48f0093b]], module [[6c81c6f3]], reference shape the Git kit [[adeeb4ba]].

The file names an external reference for the same rule; a claim about what another system does belongs here only where this code decides something about it. Done when every invariant and limitation stands as a claim bound to sources that can contradict it and verified after reading each, `run_doctor` over this path leaves nothing open, and a review passes.