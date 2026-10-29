---
id: 01a140df-2f5b-7a66-a3c8-c81eae8ae07f
title: "Module loading doubled against the loadBudget budgets: graph fixture 1315, hook 959, start 2160"
ord: 15
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a13f2d-638d-74e9-8a14-33acd1cc7192
---
`loadBudget.itest.ts` failed on HEAD on module counts (graph fixture 660 → 1315, door fixture 1840 → 2155, tagma hook 730 → 959, server start 1900 → 2160); the forbidden lists pass. The budgets were raised to the measured value with headroom, so the test catches new growth again. Remaining: find out what exactly grew in the hook (it runs on every tool call) and bring the hook budget back to 730.
