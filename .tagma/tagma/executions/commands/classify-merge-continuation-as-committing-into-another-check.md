---
id: 01a19405-bf84-70bf-a4dd-0af83fa2b6e2
title: Classify merge continuation as committing into another checkout
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75f-7249-8b8f-36444a9361c0",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a127d7-64ed-72f9-982c-b4fead143626
---
Recognize git merge --continue as the existing commit-elsewhere effect when bash targets another registered checkout. Preserve the approval declaration, thresholds and same-checkout shared-sweep classification. Reproduce both finishing forms against one resolved merge through the public bash preparation door, then conclude it and verify its two parents.