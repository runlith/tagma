---
id: 01a0ca95-3103-7bee-95f2-f7fd5d8cd279
title: Write the claims of the provider accounts and the one list of models
ord: 186
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Two adjacent areas, and the second exists because the first is read by it: [[29951026]] and [[e79e37c6]].

Read `apps/tagma/app/src/lib/features/accounts` and `apps/tagma/app/src/lib/features/models` whole, with the accounts tests — `status.ts`, `windows.ts` and `cacheLifetimeWords.ts` each have one and they pin the quota-window arithmetic. Load the `svelte5` skill first.

Two files under `accounts` landed shortly before this cut; read them fresh rather than from any summary. [[15cc1072]] already stands under [[e79e37c6]] and says the catalog list is one component with a per-owner foot — verify it still holds against the code and do not write a second claim over it.

The module above is [[cc59eadf]]; the model vocabulary itself belongs to [[249ce587]]. The reference zone is [[cb732496]].

Done when: the claims are written from the code and verified, the doctor over both paths is clean, and a review passes.