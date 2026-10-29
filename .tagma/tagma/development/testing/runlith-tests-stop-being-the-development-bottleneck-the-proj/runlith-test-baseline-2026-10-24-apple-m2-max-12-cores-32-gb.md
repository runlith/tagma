---
id: 01a16bdc-98c4-7d17-a30d-170a3c13cbc1
title: "runlith test baseline, 2026-10-24: Apple M2 Max, 12 cores, 32 GB, under other agents' load"
ord: 20
---
One measurement on one machine. It is the reference point for [[38ef1770|test speedup]], not a norm: numbers differ on another machine and under other load.

## Machine and load

- Apple M2 Max, 12 cores (8 performance + 4 efficiency), 32 GB, macOS 26.0.1; Bun 1.4.3, Node 26.8.1.
- The machine never idled; other agents ran tests in parallel. At the start 36.6% of the machine was busy at load average 5.2, at the rerun 24.6% (Tagma 7.3% of it).
- Minute load average during server itest and stest (152 readings): min 2.4, p50 6.1, p90 9.5, max 12.2.

## How it was measured

- Every suite ran with its own script through the `testbed` CLI (commits 5e187d7c0f, c22dcfd85f, b35337cb3a), with `--randomize`. Every report row is a testbed ledger: the file, its articles, and children by kind.
- Server itest and stest ran in 12 shards (`--shard=k/12`, split by file count), three shards at a time. Packages ran one suite at a time. App: `unit*` and `system`.
- **Wall is the sum of run walls**, i.e. sequential-pass time. Real time at three parallel shards is about three times less; never measured separately.
- CPU includes children: SQLite, git, and other processes the file started.

## Project total

2177 files, 13,618 tests. **Wall 2785 s, CPU 5220 s.** Resource files (`*.itest.ts`, `*.stest.ts`) took 4892 s CPU, unit files 329 s.

| Article | CPU, s |
|---|---|
| load | 441 |
| world | 1403 |
| tenant | 0 |
| body | 3125 |
| guard | 49 |

Children: sqlite — 9791 processes, 474 s CPU; git — 70,953, 941 s; other — 3599, 815 s.

Tenant is 0 everywhere: no file yet measures the shared world through `measure`, so a world rebuilt inside a body (`withDemo` per test) sits in body. Guard takes under 1% CPU.

## By suite

| Suite | Files | Tests | Wall, s | CPU, s | Load / world / body / guard, s CPU | File CPU p50 / p90 / max, ms | Guard per file p50 / p90, ms |
|---|---|---|---|---|---|---|---|
| server unit | 317 | 1498 | 14.3 | 36.4 | 24.2 / 2.7 / 4.8 / 4.5 | 85 / 208 / 1676 | 11.8 / 24.0 |
| server itest | 622 | 3330 | 818.1 | 1649.6 | 171.2 / 410.2 / 1044.8 / 14.5 | 1843 / 6055 / 18 143 | 20.4 / 34.9 |
| server stest | 255 | 1208 | 1393.3 | 2827.8 | 140.8 / 877.6 / 1787.4 / 10.5 | 8993 / 21 767 / 43 517 | 36.3 / 62.7 |
| app unit* | 229 | 1445 | 42.1 | 97.6 | 40.1 / 0.4 / 23.7 / 1.6 | 121 / 742 / 6296 | 3.3 / 17.2 |
| app system | 5 | 12 | 22.9 | 53.0 | 1.6 / 29.4 / 2.8 / 7.5 | 9590 / 11 837 / 11 837 | 375 / 3481 |
| packages unit | 508 | 4525 | 92.4 | 194.9 | 41.5 / 0.8 / 42.4 / 6.1 | 104 / 410 / 8272 | 11.0 / 19.4 |
| packages integration | 212 | 1387 | 202.2 | 203.1 | 18.3 / 12.0 / 162.0 / 3.9 | 435 / 2340 / 6249 | 16.1 / 29.8 |
| packages system | 29 | 213 | 199.6 | 158.1 | 3.7 / 70.2 / 56.9 / 0.7 | 2774 / 13 212 / 21 742 | 22.9 / 42.4 |

Children by kind, process count / s CPU:
- server itest: sqlite 5169 / 212.0, git 23,657 / 326.9, other 869 / 98.0;
- server stest: sqlite 4096 / 244.4, git 45,743 / 595.4, other 1752 / 549.4 (11 unmeasured);
- app system: other 4 / 38.0;
- packages integration: sqlite 436 / 14.3, git 1553 / 18.7, other 745 / 43.6;
- packages system: sqlite 90 / 3.2, other 229 / 85.9.

Unit files start no children: guards forbid it.

## Costliest files, s CPU

- **server unit:** `composition/operationCatalog.test.ts` 1.7 (world 1.4 of it), `composition/places.test.ts` 1.1, `composition/cli/verbs.test.ts` 0.6, `composition/handles.test.ts` 0.6.
- **server itest:** `enforcement/baseMerge.itest.ts` 18.1 (456 git, 5.9 s), `threads/terminalCore.itest.ts` 10.8, `graph/farEdges.itest.ts` 10.6, `http/blocksDoor.itest.ts` 10.1, `change-record/threadAuthorship.itest.ts` 9.8, `threads/terminalProof.itest.ts` 9.7.
- **server stest:** `threads/parityRequests.stest.ts` 43.5, `parityRestarts` 39.2, `parityStops` 36.7, `parityFinished` 33.3, `managed-browser/engine.stest.ts` 32.8 (browser, 30 s in children), `threads/parity.stest.ts` 31.4.
- **app unit:** `executions/terminal/Pane.svelte.test.ts` 6.3, `threads/Column.svelte.test.ts` 4.1, `checkout/DiffStage.svelte.test.ts` 1.8.
- **app system:** `terminal/inputComposition.stest.ts` 11.8, `paneComposition.stest.ts` 10.8, `checkout/files/editing.stest.ts` 9.6. Each about 7 s world and 8–11 s at one child.
- **packages unit:** `chat-ui/src/FeedRegions.svelte.test.ts` 8.3. Next cost about 1 s: `chat-ui` ChatSurface.escape and `agent` conformance files.
- **packages integration:** `performance/src/PerformanceReports.itest.ts` 6.2, `sqlite-process/src/SqliteProcess.itest.ts` 5.7, `performance/src/PerformanceStore.itest.ts` 5.2, `execution-host/.../streaming.itest.ts` 4.8.
- **packages system:** `apps/tagma/demo/tools/walk.stest.ts` 21.7, `execution-host/.../restart.stest.ts` 14.6, `logicFailure.stest.ts` 13.2, `packages/tagma/kit/distribution.stest.ts` 12.6.

## Failures

No failure was caused by testbed. Server itest verified by running each file separately with the old preload. For stest and packages: no log carries a guard refusal (`LayerViolation`, `NetworkReached`), but they were never compared with the old preload. The per-file list with causes sits in `~/.tagma-dev/scratch/01a16b08-ee15-7003-95b6-d5dd064444b4/baseline/failing-files.md`, raw `*.jsonl` reports and logs beside it.

- **Server itest, 31 files.**
  - 21 files are order-dependent: in declared order a file passes, in a shuffled run it fails.
    - 20 of them fail alone under `--randomize` too: 16 with at least one of seeds 1, 2, 3, 4 more confirmed earlier.
    - `runActivity.itest.ts` is green under all three seeds: it failed from neighbor files or load.
  - 10 files red on HEAD too.
- **Server stest:** 35 files. Nearly all contract mismatches: place-mismatch instead of foreign-project, this machine's default models, etc. Plus timeouts.
- **Packages:** 10 files.
  - `executions` wire.test: WIRE_VERSION never raised.
  - Integration: `activity`, `agent` ContributorWithdrawal, four `execution-host` files, `highlight` session.worker, `navigation-ts` launcher, `performance` MemoryCaptures.
- **App:** green.

Failures not tied to files:
- the `test` script of echo, highlight, navigation, navigation-ts, ripgrep, and cloud fails with "No tests found";
- cloud integration needs Docker, which never started.

## What the figures exclude

- **34 suites wrote no row.** They have no `bunfig.toml` with the testbed preload: guards never apply to their files, and there is no cost. These are `checks/law`, all `adapter-*`, browser-cookies, builtin-catalog, bundle, cdp, codesign, credential-file, file-lock, github, held, paging, search-text, vite-browser-guard. Of `packages/` 83 packages, 40 carry `bunfig.toml`.
- cargo, swift, and native builds at execution-host, visual-identity-node, and audio-darwin skipped.

## Preload cost

Empty unit file, CPU per file:

| Mode | old `test/` preload | `@runlith/testbed` |
|---|---|---|
| `--isolate` | ≈14.7 ms | ≈15.7 ms |
| `--no-isolate` | ≈2.5 ms | ≈3.3 ms |

About 10 of these 15.7 ms go to recreating guarded builtins in every fresh global. They cannot switch lazily: Bun never routes builtin `require` through `Module._load` and `Bun.plugin`.

Verifying the SQLite engine in every process at a standing `verified` mark now costs ≈4 ms instead of ≈120 ms.

## Observations for the next steps

- **Body — 60% CPU, world — 27%, load — 8%.**
  - Server stest and itest costliest: 4477 of 5220.
  - Git the most numerous child: 70,953 starts, 941 s.
- **Guard in app system costs 375 ms per file at p50 and 3.5 s at p90.**
  - In vitest unit files it costs 3–17 ms, in resource files under Bun 20–60 ms.
  - Assumption, unverified: vitest never opens the `bun:ffi` process adapter, and the watcher polls through `ps`.
- **Far from the spec's goal.** The spec wants the whole suite in 30–60 s; ideally laid over 12 cores, today's 5220 s CPU give no less than ≈435 s. That is arithmetic, not a measurement.
