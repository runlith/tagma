---
id: 01a16e6e-69ed-71ba-9c40-72eecffc50bb
title: "execution-host inventory revision depends on SQLite delay: 64 KB of output moves it further than one byte"
ord: 7
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16e17-e820-7c49-8513-b1553201be28
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b702168725a4
sources:
  - kind: file
    ref: packages/execution-host/src/CommandInventory.itest.ts
  - kind: file
    ref: packages/execution-host/src/InventoryChanges.itest.ts
  - kind: file
    ref: packages/sqlite-process/src/inline.ts
---
On `sharedPool` (`inlineHosting`) the first `CommandInventory.itest` test ("retains admitted and childless work…", line 315) fails: the inventory-revision gain for `head -c 65536 /dev/zero | tr …` is 10–12, for `printf x` 8. On `childHosting` both are equal. So in ab58000a22 the file stays on child processes.

Two other mismatching checks of the same file turned out to be a wakeup race, not a hosting property. ab58000a22 fixed them, see [[f46f78a5]].

Candidates for stray `inventoryMoved`: program-rule deadline extension (`calls.revise` with `cause: 'rule'` in `registry/assembly.ts`), re-marking `printed`, and stream ends. Under IPC delay they seem to merge into one change. What is needed: find which act moves the revision with output volume, fix at the producer, and move the file to `sharedPool`.

Total: the product is not at fault, the measurement window was. More moves came with the one-byte command (10–11 vs 8): its window ran first and caught asynchronous `release`s of runs stopped earlier in the same test. Each command makes its own `release` in a separate fiber after the end, and it landed in its own or another window. The measurement moved into a separate test (e2a2b90030): each command gets its own new host, and the window lasts until it leaves the live map (`left` in `changes`). The whole `CommandInventory.itest` runs on `sharedPool`: three runs in a row, 5/5.
