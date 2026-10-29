---
id: 01a16e17-e820-7c49-8513-b1553201be28
title: "ProcessPool and store opening never pick SQLite hosting themselves: the childHosting default and new ProcessPool() move to composition"
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a16e04-e4a2-7707-aae0-722c1e1fdc28
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b702168725a4
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/open.ts
  - kind: file
    ref: packages/sqlite-process/src/ProcessPool.ts
---
The `ProcessPool` constructor (`packages/sqlite-process/src/ProcessPool.ts`) defaults to `childHosting`, and `sqliteProcessLayer` and `storeLayer`/`machineFileLayer`/`seededStoreLayer`/`seededMachineLayer` (`platform/store/open.ts`) build `new ProcessPool()` by default. So the core itself picks the variant, which breaks [[6f758080]]; the 0e6826c8c1 commit review pointed at it. Server composition already passes `childHosting` explicitly, test worlds pass `inlineHosting` through `heldPool`/`sharedPool`.

What remains: make `hosting` and `processes` required and carry the pool from composition to every caller. On 2026-10-24 that is about 140 pool-less sites, mostly tests (and `cli/database.ts`, `installation/registry/restore.ts`, `snapshot.ts`, activity, execution-host). A pool-less test then moves to `sharedPool`, while a test whose subject is the process explicitly takes `childHosting`.

Done for execution-host (0cffabdeb4). `executionStore` and `hostState` require the pool; `host.ts` builds a pool with `childHosting`. 25 itests open the store on `sharedPool`. On `childHosting` stay the tests that kill a SQLite child (`ExecutionStore`: five writer-death tests, `ExecutionStoreLoss`, `ExecutionStopReceipts`, `Custodian`), both benches, and the `timingResume` writer process. `InventoryChanges` and `CommandInventory` moved to `sharedPool` later: in ab58000a22 with the inventory-wakeup-race fix, and in e2a2b90030 with the measurement-window isolation (see [[cffc50bb]]). The module's `children.ts` and `ProcessPool.ts` entries of `@runlith/sqlite-process` are opened to the execution-host modules.

Done for server store open (5ab8616835, 48c68b305a, 21ad576681): `storeLayer`/`machineFileLayer`/`seeded*` and `machineStoreLayer` take the pool as a value or the Effect that provides it (`PoolSource`, `poolOf`), so a test passes `sharedPool` directly; the installation-registry recovery (`installation/registry/restore.ts`) runs on its own store's pool; 13 itests moved to `sharedPool`.

What remains: the default `new ProcessPool()` and `childHosting` in `packages/sqlite-process` and `platform/store/open.ts`; about 90 pool-less callers in server, activity, cli; the product's `platform/store/snapshot.ts` (`restoreParticipantInto`, scrub and restore in `storeSnapshots`) builds pools itself — `take` may take the `store.processes`, the rest need the pool carried from composition. Signature changes go in compatible steps (first every caller passes the pool, the default drops last): in one sweep across the shared tree it broke neighbors' imports.
