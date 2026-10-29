---
id: 01a0dfe2-aedd-75e7-90a3-95b47c4a6068
title: Remove repeated discharge of already-finished managed processes
ord: 50
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0dfe3-838e-7067-9f57-dbbe9620805b",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/store/terminalDischarge.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/discharge.ts
  - kind: file
    ref: packages/executions/src/executionSpawner.ts
---
Check and remove redundant process-completion work on the managed path without bypassing the host: in trace 7c54d92d01b09e00ea757688e990fbcc, stop and retire passed sequentially with a repeated discharge of one execution after a short git; stop took 410 ms elapsed, mostly waiting on sqlite, while the host answered in 5.5 ms. Start with Terminals.discharge, TerminalStore.discharge/dischargeCommand, and the executionSpawner scope finalizer. Keep [[655cff10|discharge only on proven completion]], repeatability, and recovery from partial failure, completion of grants/uses/lanes, leftover processes, and uncertain operations. Remove repeated transactions where the obligation is already settled; skipping stop is allowed only after proving its causes, receipts, and lifecycle equivalent. Verify concurrent completion, interruption, and errors; measure the same scenario before/after. Leave unconfirmed options explicitly unimplemented; run the applicable review, update the affected claims, and finish with a commit.
