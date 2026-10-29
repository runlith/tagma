---
id: 01a159b0-0c98-7d80-bda9-ae11b4baf26e
title: "[[name]] links between projects in read_block's refsOut and refsAbsent and \"not on this machine\" in the app"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a159a1-5659-786f-8088-acd20618c9aa",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a159ae-2c87-7eea-be0d-53316c7c8f6e
  - kind: waits-on
    to: 01a159b0-0c98-7d80-bda9-ae10b891b1e3
---
Implements [[6c7c8f6e]]: `refsOut` resolves names with the machine copy index in the same order as `read_titles`, `refsAbsent` names the unfound, the app link shows unreachability. Proof is the spec's integration test.
