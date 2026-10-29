---
id: 01a17b03-a13b-7f89-877a-c88bd6678b58
title: Shared-world background work in the test worker eats CPU and launches git between tests and after a tenant leaves
ord: 57
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17b03-b000-7845-9386-0b5c969fce44",
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
  - kind: relates
    to: 01a17ad8-bcf9-7432-bd5f-eeecac47dc8a
---
Hypothesis from the [[ac47dc8a]] reference measurement, unverified. `submitEqualLines.itest.ts`, 79th file in the worker, cost 59.7 s CPU and 948 git launches, but 12.7 s and 797 launches alone. Task: verify by fact. If background confirmed, switch off at its owner the work nobody waits for. If not, find where the difference comes from.
