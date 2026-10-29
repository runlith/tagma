---
id: 01a12b38-3e3e-7e9f-b873-d46325093e9c
title: The holder returns the proven bundle when the activated logic did not come up
ord: 19
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4ed0dc089931
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: packages/execution-host/native/holder/src/holder.rs
  - kind: file
    ref: packages/execution-host/src/store/migrationChain.ts
---
The operator's decision: take the idea [[dc089931]]. A holder that activated a bundle without exec remembers the argv of the prior bundle's logic, if it reached ready. If the new bundle's logic never reaches ready by the longest pause and there is no candidate in `bundle.next`, it swaps the bundles back and starts the old logic; PREPARE of that same bundle refuses afterwards. The logic does not open a store in which migrations outside its chain are applied (`StoreAhead`). Proof — `logicReturn.stest.ts` on a real holder.
