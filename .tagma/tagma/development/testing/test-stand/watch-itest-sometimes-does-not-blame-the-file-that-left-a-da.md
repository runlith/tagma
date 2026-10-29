---
id: 01a17bc1-a01d-7b75-a899-a9fc054f5a04
title: watch.itest sometimes does not blame the file that left a daemon while the module loads
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17bce-4cee-7d48-b88e-bdd094317a80",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17ae4-e99c-7a84-8f27-dfb955b6930a
sources:
  - kind: file
    ref: packages/testbed/src/watch.itest.ts
---
A 2026-10-27 run `testbed bun test --no-isolate --randomize --seed=3` of all `packages/testbed/src/*.itest.ts` failed on `watch.itest.ts` › "a daemon left while the file loads, and a sleeper left in a recorded group, fail their own files": `blamed` lacked `a-loads.itest.ts`, only `b-group.itest.ts` stayed. The same seed rerun whole right after passed 39 of 39, and seeds 1 and 2 passed too. So the failure depends on time, not order. Find why the testbed process watch sometimes does not tie a module-top-level daemon to the file, and fix at the owner.

## Root

The helper-exit window in XNU: `proc_prepareexit` hides the process from `proc_pidinfo`, then `fdt_invalidate` closes its files (EOF of stdout), and only then the daemon is reparented to launchd. `suspects` (`core/watch.ts`) took only processes born since the file start with `ppid === 1`. When the verdict's first scan fell in the window, the daemon still naming the invisible helper as parent never entered the suspects, the scan was empty, and `verdict` left with no grace. The daemon was later removed by the nested runner's `--no-orphans`, hence `alive: false` in the report. A guard defect, not a test one.

Measured 2026-10-27, M2 Max, Bun 1.4.4, one sample:
- Helper EOF probe (daemon and helper `facts` right after EOF), 16 processes of 120 rounds each, load ≈8: the window open in 236 of 1920 rounds, lasting up to 47 ms; with no load — 0 of 300.
- From helper EOF to the verdict's first scan of `a-loads` in the `a-loads`/`b-group` pair run with a real preload, 2.8–11.6 ms, median 5.8 (n = 32).
- Repeating the pair under load (24 in parallel × 6) with a temporary verdict trace in a separate worktree: before the fix 1 of 144 runs did not blame `a-loads`, the run exited 0, the first scan `found: []`, and the trace right after the scan sees the daemon already with `ppid 1`. After the fix 144 of 144 blamed, 0 empty first scans, and in one run the first scan found the daemon with the already invisible helper's `ppid`.

## Fix (`b681c01e88`)

An orphan is a line whose parent is launchd or no longer visible to the `Processes` port, for born lines and for the cwd check of mark-less lines. Ancestor walk admits a held parent's pid even with no line: an invisible parent may be a living process of another user held by the test (review finding). The cause is recorded in [[404e7e7c]].

No deterministic test of the defect. The kernel window could not be held from userland: neither stopped XOFF output into a pty nor a TCP socket with `SO_LINGER` and unsent data holds a helper's exit on macOS. The `watch.itest` scenario stays the regression net: before the fix it turned red in about 1% of loaded runs, after it this case has no time-dependent path. The window on the `ps` adapter and on Linux is neither closed nor measured.
