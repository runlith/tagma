---
id: 01a0d136-c55b-7df0-b272-eaffc50f5fd3
title: "Draw the team strip in the thread header: one chip per spawn step with state dots, name, vendor glyphs, a highlighted asking chip and a member menu"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d138-ddff-7591-b1c4-899dea7834d6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d136-c2d9-7e3c-9701-58ec6c0d60a2
  - kind: waits-on
    to: 01a0d136-c5cd-7ddb-b0e2-375737a0a3ab
---
Build [[6c0d60a2]] in `ThreadHeader.svelte` with a strip component beside it, grouping the open thread's children by `bornOf`. Done when the review-pair acceptance case holds and a pre-change team shows a chip per child; write the claim the strip stands on. Size: medium.