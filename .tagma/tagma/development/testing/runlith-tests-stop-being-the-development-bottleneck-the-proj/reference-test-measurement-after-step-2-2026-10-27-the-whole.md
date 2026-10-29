---
id: 01a17ad8-bcf9-7432-bd5f-eeecac47dc8a
title: "Reference test measurement after step 2, 2026-10-27: the whole suite 676 s wall and 2591 s CPU under load"
ord: 52
---
Measurement 2026-10-27, after step 2: tests no longer fail on timeout. Commit `b19d85d`, a separate detached worktree, `bun run test:all --script test`, then `--script test:integration`. Apple M2 Max, 12 cores, 32 GB, macOS 26.0.1, Bun 1.4.4. One sample. The machine never idled: the operator's other threads worked, load average 5–10 during unit, 15–26 during integration. So CPU compares; wall is inflated by core contention.

## Total

| Part | Wall | CPU |
|---|---|---|
| All unit suites | 92.5 s | 320 s |
| All integration suites | 583.8 s | 2271 s |
| Whole suite | 676 s (11.3 min) | 2591 s |

Each suite's reports and logs: `~/.tagma-dev/scratch/01a16e20-3dd6-7696-901e-d29696ccb336/baseline/` (`unit.json`, `integration.json`, and `.d` catalogs). They live while the thread lives.

## Costliest suites

| Suite | Files | Tests | Wall | CPU |
|---|---|---|---|---|
| server integration | 754 | 3433 | 454.6 s | 2057 s |
| app unit (Vitest) | 248 | 1462 | 20.2 s | 128 s |
| execution-host integration | 97 | 557 | 45.7 s | 85.5 s |
| vitest packages | 119 | 1193 | 11.8 s | 69.5 s |
| audio-darwin unit (`swift test`, with build) | — | — | 26.5 s | 29.6 s |
| execution-host unit | 36 | 365 | 18.3 s | 19.9 s |
| agent unit | 165 | 1560 | 2.6 s | 19.6 s |
| server unit | 365 | 1701 | 2.0 s | 16.4 s |

Server integration is 79% of the suite's CPU. App unit — 87 ms CPU per test, server unit — about 10 ms.

## Server integration by article

Testbed article CPU — 2140 s:
- body — 1542 s (72%);
- world — 385 s (18%);
- module loading — 122 s;
- tenant — 82 s;
- guard — 9 s.

Children:
- git — 50,884 processes, 501 s CPU;
- other — 900 processes, 203 s;
- SQLite — 311 processes, 11 s.

Bodies took 3467 s wall at 1542 s CPU. No waiting can be extracted from a thousand-plus uncovered wall seconds: at load 15–26 core contention sits in it. 10 workers held 4.5 cores loaded on average.

Costliest in CPU are landing and enforcement files:
- landing — 371 s CPU, 10,454 git starts;
- enforcement — 278 s CPU, 6941 git starts.

Costliest file — `landing/submitEqualLines.itest.ts`: 59.7 s CPU and 948 git starts. 62 tests past their kind's threshold are in the `slow` report.

## This run's reds

None failed in step 2's area runs.
- `execution-host/CompilerQualification.itest.ts` — a sub-1500 ms wall check measured 1512 ms.
- `audio-darwin/conformance.itest.ts` — no built `bin/audio-helper` on the fresh checkout.
- `platform/testing/spawn.itest.ts` — a 180 s hang interrupting a spawned command.
- `platform/watch/tree.itest.ts` — a stray watcher event.

No curve by worker count taken: under this load it says nothing.
