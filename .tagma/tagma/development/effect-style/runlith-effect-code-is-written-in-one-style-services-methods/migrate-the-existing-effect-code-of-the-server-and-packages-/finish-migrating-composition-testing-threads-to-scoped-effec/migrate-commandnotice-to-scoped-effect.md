---
id: 01a14c52-4135-7427-aab6-2f158768bbae
title: Migrate commandNotice to scoped Effect
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae6-7c7d-9cc2-edc404b6eb7f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/commandNotice.itest.ts
---
Migrate commandNotice.itest.ts to the shared scoped fixture and native Effect, keeping durable delivery of command completions, delivery cancellation and turn-opening races. Proof is the file's typecheck and its nine tests; the parent task's whole work has a single reviewer, covering this file too.
