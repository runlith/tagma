---
id: 01a17be6-dbca-7a51-937b-c3df11338636
title: Fresh testbed runs starting together fall in `sweepRuns` with EPERM deleting one dead root
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17bce-4cee-7d48-b88e-bdd094317a80",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17bc1-a01d-7b75-a899-a9fc054f5a04
sources:
  - kind: file
    ref: packages/testbed/src/core/run.ts
---
Analysis 2026-10-27, [[054f5a04]]: with three parallel itest testbed runs on `--randomize --seed=3` two fell on foreign facts. `watch.itest.ts` › "in a sequential run, what a file starts in its own beforeAll…" and `cli.itest.ts` › "a slow Vitest test is reported…" got from the nested run `EPERM: operation not permitted, rm '/tmp/runlith-test/run.<pid>.<ms>'` from `sweepRuns` (`core/run.ts:116`), called from preload (`bun.ts:82`) and from `cli.ts:79`. The same refusal gave 3 of 295 runs of the `a-loads`/`b-group` pair at 14–24 parallel starts. In preload it drops stand preparation whole: files go with no guards and no guard.

`watch.itest` itself starts three fresh runs at once (`shared`, `serial`, `hooked`), so the race is possible in a single run too when a dead root lies in `/tmp/runlith-test`. The EPERM mechanism unestablished: three simultaneous recursive `rmSync` of a synthetic tree (20 directories of 50 files) in 30 repeats gave no error. Find what in the run root gives EPERM on concurrent delete, and fix at `sweepRuns`.

## Root

Nothing special in the root: EPERM came from Bun 1.4.4's recursive `rm` itself (`src/runtime/node/node_fs.rs`, `zig_delete_tree_open_initial_subpath` → `dt_delete_file`). Bun starts with `unlinkat(root)`, on macOS that is EPERM for a directory, and refines the directory through `lstatat`. When another process removed the root between these calls, `lstatat` fails and Bun returns the original EPERM with syscall `rm`; `force` does not quench it. Large trees barely show the race: the second remover must arrive at the very end of the first one's work.

Measured 2026-10-27, M2 Max, one sample:
- three processes deleting one small root (one recreating it), in 3 s: 669 EPERM on the root;
- real `sweepRuns` in several processes over just created dead roots: before the fix 3 EPERM per ~2550 passes and 7 per 3353 with six sweepers; after — 0 per ~5000 and 0 per 3285.

## Fix

`sweepRuns` takes the dead root with `renameSync` into `<pid>.swept.<uuid>`, skips it on ENOENT and deletes its own path; the cause is in [[1d89df23]]. No deterministic test: the window lies between two syscalls inside Bun.
