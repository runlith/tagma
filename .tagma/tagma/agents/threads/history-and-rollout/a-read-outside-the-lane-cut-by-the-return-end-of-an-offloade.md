---
id: 01a141c7-b9c6-74fa-8363-794020b30253
title: A read outside the lane, cut by the return end of an offloaded thread, fails "has no log row" instead of retrying
ord: 8
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a141b7-2a33-710f-8a8e-2d5ae7656ace
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutWhole.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/rows/threadUnits.ts
    symbol: makeThreadUnits
---
A read unit (`ConnectionUnits.read`) is not a snapshot: every request sees the last commit. `foldMissing` reads the `thread_log` row and the offload mark with different requests, so a read that started before the last `rehydrateThreadRecords` transaction (no log, mark stands) and finished reading after it (log back, mark cleared) answers `ThreadStorageFailed threadLog` instead of history. The first `transition` attempt (`prepareTransition` → `readAt`) turns only `ThreadVersionStaleError` into a retry inside the lane, and passes this failure through: this is how settlement `01a141b5-fdb7…` fell (the `hosted runs` subscriber, `Questions.close` → `parked.clear`).

The parent-task commit removed the cause for new threads (they are born with the `last` form mark and are no longer reduced as a whole). A window remains for a thread that lags legitimately — once after a new form step ships: `rolloutWhole.resident` checks only the running run, while the ended run's settlement is still going.

What to do: a torn read at the owner answers as stale (the `fold_rev` version already moved by `thread_log` triggers), or the `foldMissing` verdict is read in one request with the history itself; decide whether `resident` must await the run's settlement. Proof — a test on the `native-harness` layer: a read overlapping the return's final transaction answers with history or a retry, not `threadLog`.
