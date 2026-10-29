---
id: 01a1275d-3b87-78ab-93cf-5c26f239dadb
title: Enforcement remeasure at start doesn't recompute unchanged trees and yields to foreground
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127bd-704c-784f-aa80-e207bb12fb45",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-42259ae1db7b
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/driver.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/rule.ts
---
After a restart, enforcement remeasure loads CPU in proportion to known checkout count even when trees didn't change. Operator sample of 2026-10-10 at 19:26:09, 68 s after server pid 64556 started: all 12 cores busy, install processes — 8.08 cores, agent commands — 0.2. Two server children ran `git -C <worktree> grep -l -z -F -w -e catch -e catchEager … -- apps/tagma/server/src packages`: the `commit-steps` worktree — 4.18 cores, `changes-intake` — 2.19; the project has 12 worktrees. This is one sample, not a profile or whole-startup measurement.

The cause is in enforcement, past the window door and recovery: `serving.ts` passes `Maintenance.opened` to `remeasures`; `driver.ts` picks every `enforcing.all()` with aim `Start`. `chosenRules` in `rule.ts` includes every measured rule, and each rule/checkout gets an independent fork through `schedule`/`wait`; `remeasureRule` runs `measureReach` with no check of the past tree. In today's composition the latch opens after full `recoverRuns` and `StoreSnapshots.ready`. Moving the launch into composition doesn't fix the count and priority of that work.

Fix at the remeasure owner: keep the identity of a truly measured tree and rule declaration, don't remeasure an unchanged checkout on the next start, run background remeasure one checkout at a time and yield to foreground inspection. Unfinished journaled landings and a changed rule stay driven; a refusal or interruption doesn't mean a measured tree. Start from `enforcement/remeasure/{driver,rule}.ts`, `rules/measurements.ts`, `workers/inspectionLanes.ts`. Proof is the public remeasure road: a repeated start over the same tree doesn't launch a full walk, a new tree and an unfinished landing are measured, foreground doesn't wait for the whole start queue. A narrow sample shows no fan-out over worktrees; checks no longer than 60000 ms, no shared suites.
