---
id: 01a16023-4386-715f-8a0a-768e6b901a48
title: "ACP: close launch and wake races, word order, and compaction"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16022-fe83-7eff-833e-434f8d3c0add",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24da026af37c
---
Fix four ACP defects after word delivery: launching a stopped turn, wake before the turn leaves the index, steer order in the journal and history, the compaction refusal at the turn boundary. Confirm with public contract tests.
