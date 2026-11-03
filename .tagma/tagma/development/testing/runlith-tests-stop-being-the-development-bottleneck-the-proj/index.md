---
id: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
title: "runlith tests stop being the development bottleneck: the project's whole suite in 30–60 s, 20× cheaper change verification, no layers by cost"
ord: 12
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: dir
    ref: test
---
**Why.** Agents write runlith's code, and every one of their "change → verify" loops runs into tests. The server's integration layer runs tens of minutes, the app's unit layer minutes, and several agents' parallel runs hold the machine's CPU at its limit. Costly checks run rarer and narrower, so red on HEAD sits unseen: on 2026-10-23 — two server unit-layer tests and two in one app unit-layer file ([[0c2de9a6]], [[c2ad3cd7]]). Goal — the project's whole test suite passes in 30–60 s wall, and a change check costs the checks themselves, not their setup.

**Operator decisions.**
- **No layers by cost.** The system layer (`*.stest.ts`) is gone. Two file kinds remain: unit — no real resources, guards at the call site; and `*.itest.ts` — a mark "this file may use real git, SQLite, processes, disk". Itest stays narrow: conformance of adapters on real resources and a few end-to-end paths through the real door ([[571311f8]]). Both kinds run on every change check.
- **The current 859 itest and 294 stest files** split three ways: logic — to unit over fast adapters, boundary — to narrow itest, junk — deleted ([[4dbd9a84]]).
- **A test fails only on its own fact** (2026-10-26). Test time and machine load never decide the outcome: the stand's only timeout guards against hangs, 3 minutes per test and hook. A test past its kind's threshold (1 s unit, 10 s integration) passes and lands in the run report with its cost and cause; that is a reason to cheapen it at the owner, and moving or splitting a file never counts as cheapening. Timeout constants inside tests become waits on the fact.
- **The goal is the whole run's time**, 30–60 s wall per project, in the report next to the file budget. The testbed sets the test process count from the machine's budget share.

**Measurements.** 2026-10-23, Apple M2 Max, 12 cores, 32 GB, macOS 26.0.1, Bun 1.4.3; each a single sample.

| Suite | Tests | Wall | CPU |
|---|---|---|---|
| server unit, `bun test src --parallel=2` | 1494 in 318 files | 18.6 s | 39 s |
| server integration, graph part (110 files), `--parallel=2` | 478 | 223 s | 395 s, of it sys 122 s |
| same with `--no-isolate` | 477 | 186 s | 295 s, 6 failures at 5 s |
| app unit, vitest, 2 workers | 1445 in 229 files | 215 s | never measured |

In the graph part, CPU per file (own process plus reaped children): p50 2.75 s, p90 6.35 s, max 12 s (`farEdges.itest.ts`). It is not slow from a few heavy files: 10 s per file would sink one file in 110, but the part runs 223 s. At the app, test bodies took 52 s total, while import took 216 s, environment 129 s, transform 127 s. The project's whole suite was never measured; over 3000 s CPU is an extrapolation.

Two probers. Phases in them are the own process's CPU (`process.cpuUsage()`), the total the own process plus reaped children:
- a full-runtime world (`makeDoorWorld`), one test, total 9.1 s: import 1.6 s, `makeRuntime` 4.4 s, `stealthProject` 1.0 s (product `git init` and `add_project`), the operation 0.05 s; the remaining ~2 s — children: 12 Bun SQLite child processes, 41 git processes, `osascript`, `ps`, `pgrep`, watcher — never split by cost category;
- a graph world (`demoGraphLayer`), three empty tests, total 2.7 s: import 0.47 s, first build 1.08 s, each next open 0.08–0.11 s of the own process; ~0.9 s above that — mostly CPU of the SQLite children of each open.

`graph/serving/projects.itest.ts` (13 tests) raises 44 SQLite child processes and ~80 git processes. With `--no-isolate` worlds still built per file; 6 failures ran 5 s each, although preload sets the integration layer 10 s — the timeout's source and the failures' cause never established.

**Baseline ([[3c13cbc1]], 2026-10-24, under load).** 2177 files, 13,618 tests, 5220 s CPU: body 3125 s (60%), world 1403 s (27%), load 441 s (8%), guard 49 s (1%), tenant 0 — no tenant measured anywhere yet, so a world rebuilt inside a body (`withDemo` per test) sits in body. Server stest — 2828 s (54%), server itest — 1650 s (32%). Children: git 70,953 processes and 941 s, SQLite 9791 and 474 s, other 3599 and 815 s. The "90–95% is setup" hypothesis is refuted for the whole suite: setup looks like 35%, the rest splits between the tenant, product git, and real bodies; only a tenant measurement splits them.

**Hypothesis, not diagnosis.** Most of a resource file's cost is not checks: import, per-file world, per-test tenant, spawned processes (SQLite, git), and the process watcher. Nobody ever measured real test bodies: preload writes one row per file. So the first delivery is a report splitting real files' cost across four cost categories: world, tenant, body, guard. The rest of the order is refined from it. The lower bound is already visible: ~0.04 s CPU per test all together, while one graph-tenant open today costs more.

**What gets built, in order.**
1. [[3e26831e|Layer core, measurement, and report]] — split by cost category, baseline, a watcher that knows the world's processes.
2. [[168725a4|One SQLite pool per worker]] — without it a per-worker world has nothing to stop spawning children with.
3. [[ff15f336|World per worker]] — rests on 1 and 2.
4. [[14455f40|Tenant at copy cost]].
5. [[be3ac0e2|Lazy runtime build]].
6. [[4dbd9a84|Fast adapters and the current itest/stest split]] — the largest part.
7. [[05af9265|Change verification]].
8. [[a099f1ad|App unit layer]] — independent of 2–6.
9. Slow-test report with cost and cause instead of a timeout, and the law over the decisions above.

**Law.** 2026-10-24, on the operator's word, removed the integration-file budget rule (8 s CPU, outcome "move to system") and the system-layer rule (60 s wall), and took the 1.5 s budget out of [[ad3c527d]]; guards stayed. Step 9 adds the rule that a test fails only on its own fact. The `test/layers.ts` code (`BUDGET`) prints the earlier budgets until the kit; rules naming `test/layers.ts` move to the kit.

**What it costs.** Isolation, not coverage. A shared world brings order dependence, and Bun lays worker files out by path and timing, not seed (`bun-types/docs/test/parallel.mdx`, "How files are distributed"). So the report writes each worker's file sequence; a failure replays by running that sequence with `--parallel=1 --no-isolate`, and file pairs iterate an explicitly shuffled list. An isolated full run goes on every kit or world-definition change and in CI. Fast adapters are verified with the same conformance suite as the real ones, and part of every run's tests goes on the real ones. State leaking between one runtime's projects is a product defect: a user with several open projects sees the same.

**Acceptance.**
- The four-category baseline taken with the kit's report before the second delivery, with the same commands on the same machine: every server, app, and package test; recorded as a note under this spec.
- The project's whole test suite — 30–60 s wall on the measurement machine; CPU and wall 10–20× below baseline.
- Change verification (per [[05af9265]]) on the commit sample named in its spec 20× cheaper than a full run.
- No `*.stest.ts` files left; every current itest and stest file reached one of the three outcomes.
- Unit-layer guards refuse the same as today: process, disk, socket, SQLite; network closed. The watcher's only change: processes a live world registered are judged at the worker's exit and by the next run (see [[3e26831e]]).
- A test fails only on a hang; a slow test passes and lands in the report with cost and cause; no timeouts inside tests.
- All tests green on three shuffled file lists and in the isolated run.

**Boundary.** Product Tagma changes this spec touches are named in the deliveries: manifest drivers ([[be3ac0e2]]), cheaper project birth at the producer ([[14455f40]]), the disk, git, and process ports that composition fills ([[4dbd9a84]]), and — only if the report demands it — opening the store through a port from composition ([[168725a4]]). A run report as Tagma's input for any users and runners is a separate thought: [[6852d8d4]].
