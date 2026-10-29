---
id: 01a0ca95-30f1-7e5d-bf91-664efccaf3ea
title: Write the claims of the application graph and the place the address names
ord: 181
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Two small adjacent areas that answer one question between them — what a key is scoped by: [[8aaab0d7]] and [[f0bc5c8a]].

Read `apps/tagma/app/src/lib/app` and `apps/tagma/app/src/lib/features/workspace` whole, with their tests. Load the `svelte5` skill first. The rung ladder — project, thread, graph — is the subject: which tier a key stands on decides when it is rebuilt, and the layouts under `src/routes` key their content on exactly that. `address.ts` carries twenty-one exports and is read by every other folder; it is the address vocabulary and deserves its own claims.

The module above is [[cc59eadf]]; [[59cc3c49]] is the kit whose `App`, `Service`, `Scope` and rung vocabulary this composes — do not restate what that kit already claims. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over both paths is clean, and a review passes.