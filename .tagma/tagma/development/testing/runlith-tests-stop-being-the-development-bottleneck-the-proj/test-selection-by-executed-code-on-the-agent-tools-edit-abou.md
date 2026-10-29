---
id: 01a17d50-1adb-7b92-a7d7-14d148e75e13
title: "Test selection by executed code on the agent-tools edit: about 42 files instead of 563 (sampled measurement)"
ord: 68
sources:
  - kind: file
    ref: scripts/change/check.ts
---
One measurement, 2026-10-27, M2 Max 12c/32GB, Bun 1.4.4, load average ~17 (the machine busy with other threads). Subject — the bash-glob-authorship thread's edit: six `packages/agent-tools` files (`shellCommands.ts`, `shellFacts.ts`, `WorkspaceChanges.ts`, `bash/preflight.ts`, `removal/patterns.ts`, new `patterns.ts`) and change-record's `record/roles.ts`. Code — HEAD `30b3e42` in its own worktree; the coverage map taken on the old code, as the last green run would have given it.

## What check:change selects today

`--plan` over these paths: 563 files (537 server, 24 `agent-tools`, 2 `execution-host`), about 1870 CPU-s on the `b19d85d` baseline. One `roles.ts` alone — 523 files, about 1845 CPU-s. The cause everywhere is "import closure reaches a changed input".

## Method

Each file a separate `testbed bun test --coverage --coverage-reporter=lcov` process. All 26 files outside the server taken, plus 40 random of the 537 server ones (fixed seed). Changed lines are the diff's old side; an insertion without deletion marks neighboring lines; imports and type declarations never execute and select nothing. Levels:
- **statement** — the test executed a changed line;
- **function** — the test executed a line inside the function holding the change (strictly inside: excluding the declaration line and the closing line).

JSC marks the `class X {` line, the `constructor` line, and the closing line of an `Effect.fn(...)(function* ...)` call as executed at module load. Without excluding them, function level gave 19 of 40 server files instead of 2. Top-level constants execute at load, so editing such a constant selects everyone who loaded the module by itself: no special rule needed for that.

## Result

| | server, 40-sample | estimated over 537 | agent-tools + execution-host, all 26 |
|---|---:|---:|---:|
| loaded the changed file | 26 | ≈349 | 26 |
| function | 2 | ≈27 | 15 |
| statement | 2 | ≈27 | 13 |

Function-level total ≈42 files instead of 563. CPU: the hitting server files cost 2 s of the sample's 103 s, ≈36 s over all 537; with the package files ≈46 CPU-s instead of ≈1870. The 95% interval (Wilson) for the server's 2 of 40 runs 7 to 89 files: the sample is small, it sets the order of magnitude, not the exact count.

The two server files that executed the changed code: `composition/testing/change-record/commandMoves.itest.ts` — the very one red on this defect — and `composition/testing/sandbox/dockerWorld.itest.ts`.

Separately: processes really loaded the changed files in 26 of 40 server cases, so the static import closure selects about a third more than ever loads.

## Bun

`bun:jsc.codeCoverageForFile` inside `bun test --coverage` answers one accumulated percentage per process, with no row set and no reset. Bun 1.4.4 gives no per-file coverage inside one `--no-isolate` process; the map is taken one process per file.

## What the measurement never establishes

- Misses: tests whose outcome the edit changes but that never executed the old code's changed lines. Their count only a run of all 563 on the new code can tell. Known classes: a new module import with a load-time side effect, non-JS inputs (fixtures, SQL, Rust holder, configs), time- or order-dependent coverage.
- Map-taking cost: 66 files one process per file with coverage cost 194 CPU-s vs 116 on baseline in shared processes, but that mixes coverage overhead, per-process reloading, and machine load; the shares never split.

Measurement scripts — the `01a16e20-3dd6-7696-901e-d29696ccb336/tia/` thread scratch (`changed.ts`, `sample.ts`, `run.sh`, `analyze.ts`); alive while the thread lives.
