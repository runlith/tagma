---
id: 01a17971-50a1-79ba-ac7e-8e884a5cdf9d
title: Bun --no-orphans inherited by product processes in itest kills daemons before the testbed verdict
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17a74-e816-791a-bb1b-0340124dbba7",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/testbed/src/core/run.ts
  - kind: file
    ref: packages/testbed/src/core/watch.ts
---
`packages/testbed/src/watch.itest.ts` › "a process a test leaves behind, directly or as a daemon of its helper, fails its own file and is killed" failed once — in the full `test:all` of the public tree on 2026-10-26: load 18–23 on 12 cores, the `testbed` set in 8 workers. The nested run blamed only `leaves.itest.ts`, while `daemon.itest.ts` passed without error. Whether the daemon was alive after the run is unknown: the `alive` check stood after the blamed `blamed`. The output pid (daemon 74213, world 74215) has `world.itest.ts` starting in the same worker right after the daemon test. So the `daemon.itest.ts` verdict returned with no 8-second pause: the first scan of `suspects` held neither daemon nor living helper.

## Cause not established

Checked 2026-10-26, macOS, M2 Max:
- **Reparenting window.** Hypothesis: the test reads the helper's stdout to EOF before the kernel reparents the daemon to launchd, and `born(since)` with `ppid === 1` misses it. Not reproduced: in 1674 rounds of direct measurement (load 15–138, including up to 110,000 open fds on the helper) the helper is never seen alive at EOF, and the daemon always already has `ppid 1`.
- **Mark in the daemon environment.** `RUNLITH_TEST_RUN` in the daemon's `KERN_PROCARGS2` reads in 1000 of 1000 rounds when the environment is passed as the testbed guards pass it.
- **Outside killer.** None found in code. `sweep` of neighbouring fresh runs judges by a dead mark or root owner, and the owners are alive. Foreign `claim` homes and reapers do not hold the daemon.
- **Reproduction.** 0 of 12 file runs (three in parallel each), 0 of 13 direct nested runs (including at load 79 from 14 busy processes), 0 of 4 whole-set `testbed:test:integration` runs in 8 workers.

**Result 2026-10-26:** review (gpt-6.1-sol) found the race by reading; the order checked against `xnu-12377.1.9` `bsd/kern/kern_exit.c` `proc_exit`. First `proc_refdrain` — the helper is no longer visible to `proc_pidinfo`. Then `fdt_invalidate` — EOF of its stdout. Only then children are reparented to launchd. In this window `suspects` (`core/watch.ts:258`) drops the born daemon with the helper's ppid, and the verdict leaves on the first empty scan. The fix, unapplied: in `born(since)` and in the orphan list for cwd checks count a line whose parent is no longer visible to `processes.facts`. No regression test: the window cannot be set from userland, and `verdict` waits 8 s and kills by pid. An outside `alive` does not say when the daemon died: the sweep may have removed it even after the verdict.

## Established root of the current failure

In `check:change --package packages/testbed` both daemons are already dead before the first verdict: `found: []`, no killing by testbed or sweep. Diagnostics kept in the session scratch `watch-trace.jsonl`: daemon PID 63177 and load PID 63178 absent at lines 5–6, at lines 31–34 the guard removes only other processes. The killer is the Bun helper: `check:change` passes `--no-orphans` to the runner (`scripts/change/check.ts:231`, since initial commit; no separate justification in history), Bun carries it into the environment as `BUN_FEATURE_FLAG_NO_ORPHANS=1`, and the child Bun inherits the mode and kills a detached child on its own exit. A direct probe showed the env flag, helper exit 0 and no daemon in ps right after exit. So the check mode changed lifetime of the product's Bun processes too, not only its test helper's. The XNU hypothesis above does not explain this measured failure and stands separately unconfirmed. Fix at the testbed environment owner: `openRun` drops the inherited startup flag before preparing resources and the file environment snapshot; the native guard of an already started runner stays. This is separately measured by running `a1f57c7b-6e82-4848-80ef-5d38e084ed84:167`: after removing the env flag a parent with `--no-orphans` still removed its Bun child on exit. `watch.itest` now explicitly sets the flag on the nested runner and keeps the previous Bun helper: before the fix 2 pass / 2 fail (`a6b25915-94ea-448a-a6a7-b128f259128f317:167`), after 4 pass. Full testbed on seeds 1, 2, 3 — 37 itest + 10 unit pass each, watch alone 4 pass each; typecheck passed. `check:change --package packages/testbed`: 9 files pass, 0 from cache, 19.90 s wall / 15.27 s CPU (`de3e0049-c3ec-4b12-8221-ac9969ebfe2d:167`). Temporary diagnostics removed. Fix and regression committed in `27cdc1623a`; independent static review found no findings.
