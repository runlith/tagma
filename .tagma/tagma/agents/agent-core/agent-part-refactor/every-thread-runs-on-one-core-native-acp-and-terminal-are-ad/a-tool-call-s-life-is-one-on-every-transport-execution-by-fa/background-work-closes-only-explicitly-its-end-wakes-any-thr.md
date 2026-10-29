---
id: 01a126a2-f815-74f5-8128-d4a342a3c95b
title: Background work closes only explicitly; its end wakes any thread
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126a3-dbf3-774c-8c3a-c64297963e86",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12685-91d6-74c9-bb18-016b7edf92bf
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/store/commandRows.ts
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/signals.ts
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
---
Background work and wake-up: items 9 and 10 of the [[7edf92bf]] spec.

What to do:
- One rule in `EndingWalk.sweepRun` and `endHeldCommands`: Stop, run interrupt, and run end remove only the run's foreground work — the run's calls and commands with `createdRun` of this run in `commandWait.mode` foreground. Background calls and commands, and commands with `createdRun IS NULL`, are left alone; their own button, archive, or thread delete removes them. Stop on an idle thread removes nothing.
- The `commandAdmission.itest.ts:2621-2642` test changes together with the rule.
- `wakeUnlessCold` without the `harness !== null` check: one rule for every thread.

Done when the rule is proven by a Stop test with a background command and a background call, the wake test (criterion 10) passes, typecheck and the affected suites are green, and review under the model rule passes. Delivery: `c4ec9c8eac`; the archive interface and wiring also carry `c477c46df`, fixture changes `6b22a2d99`. All three findings of the independent Sol xhigh review are fixed: bulk archive selection is re-checked under hold, an incomplete CommandSweep refuses before the stamp, lineage is excluded by one owner projection. Rule checks show no violations; Stop, wake, and archive passed before the neighboring session's edits. By the coordinator's decision the task closes with the `commandNotice.itest.ts`, `threadArchive.itest.ts`, and full server typecheck rerun unproven: the last run was blocked by `ReferenceError: entryField is not defined` in someone else's `threads/list/select.ts` plus unfinished composition/installation edits. The coordinator re-checks after the owners fix them.
