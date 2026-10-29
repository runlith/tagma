---
id: 01a12aeb-bd45-79a7-80bf-c77e62381250
title: Host custody stuck in Unresolved after a store loss refuses every new take until the logic restarts
ord: 18
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4ecd2e350fc3
sources:
  - kind: file
    ref: packages/execution-host/src/Custodian.ts
---
Host custody stuck in Unresolved after a store loss refuses every new take until the logic restarts. If `store.acceptCustody` recorded a take and then failed with `StoreLost`/`SqlError`, `Custodian.settle` moves the state to `Unresolved` under that take's key. After that `decided` refuses any take with a different key (`CustodyLost` → `Unauthorized`). There is no production `resolve` call, and the server takes the key `host-take-<uuid>` new on every attempt (`TerminalHostCustody.takeOnce`/`opened`). As a result the floor spins status→take→`TakeRefused` until a logic restart.

Start with `Custodian.ts:119–140`: Unresolved must resolve from the store, which knows whether the take is recorded — by itself or on the next take. Done when a host test shows: after a store failure mid-take, the next take with a new key is taken or refused on the actual revision, not on `unresolved`.

Found by a review lens on commit `212f0fb5`; fixed in `54ac066910`. `Custodian` resolves Unresolved from `store.custodyAnswer` under a semaphore before the next change; the unused public resolve is removed. Revision and key-fingerprint checks stayed in the store. Before the fix both regression cases got CustodyLost instead of the actual CustodyConflict or a taken take; after the fix Custodian.itest.ts passed 8/8 in 0.869 s, HostConnections.itest.ts — 13/13 in 1.68 s, the standard typecheck clean. The rollback case uses a real SQL failure inside a transaction; the lost-answer case checks a commit, a repeat of the old key without a new epoch, and OperationConflict on a changed request. The working server and its host were untouched.
