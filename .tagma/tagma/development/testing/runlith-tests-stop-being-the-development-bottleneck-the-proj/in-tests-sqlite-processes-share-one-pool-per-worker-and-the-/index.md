---
id: 01a16ac4-44bf-7e0a-8178-b702168725a4
title: In tests SQLite processes share one pool per worker, and the store opens without durability; the fast variants are verified by the real ones
ord: 3
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: dir
    ref: packages/sqlite-process
---
**Measurement.** `graph/serving/projects.itest.ts` (13 tests) raises 44 Bun SQLite child processes and ~80 git processes; a full-runtime world with one test — 12 SQLite child processes and 41 git processes. In the integration layer's graph part, system time is 122 of 395 s CPU; the top candidate is process spawning (conclusion: fsync is mostly disk waiting, i.e. wall, not sys CPU).

**First lever — one pool per worker, no second adapter.** Every graph-world open builds a store through `machineFileLayer(...)` without a pool (`apps/tagma/server/src/composition/testing/graphFixture.ts:384`), while `machineFileLayer` by default creates a new `ProcessPool` (`platform/store/open.ts:98-102`). Reader lanes and checkpoint belong to the pool, so every open raises a writer, reader lane, and checkpoint process. Worlds get one `ProcessPool` per worker, registered with the watcher ([[3e26831e]]): one open leaves one writer, and `ProcessPool.prepare` runs once. The test store opens without durability (`synchronous=OFF`, no `fullfsync`); that step's contribution is measured separately — it is expected in wall, not in CPU.

**An in-process adapter — only if the report demands it.** The "same contract, the core never knows" thesis fails today: `Store` carries `processes: ProcessPool` (`platform/contract/service/store.ts:100`), activity, runtime composition, and installation recovery use it, the core imports the process adapter directly (`platform/store/open.ts`), and the contract includes handover, retire, writer stall of connections, reader lanes, isolated reads by a separate process, checkpoint, and child accounting. Besides, synchronous `bun:sqlite` waiting on a lock under `busy_timeout` stops the event loop while `BEGIN IMMEDIATE` holds it across an `await` (conclusion). If SQLite processes stay the report's top cost category after a per-worker pool, the in-process adapter is made as a product change: store opening moves to a port that composition fills ([[6f758080]]), and the spec names which `Connections`/`Readers` parts it executes and which tests stay on the process adapter.

**Git.** In the graph world, project repos already come from a template copy (`graphFixture.ts:352-358`); the git that remains is started by the product — the graph's shadow repo, remeasure, trees. Its cost is a tenant cost category ([[14455f40]]), not a test-boundary one.

**The real verifies the fast.** Nothing a test gets instead of the real — a per-worker pool, durability-free storage, an in-process adapter if one appears — is taken on trust:
- the store contract's conformance suite runs on every variant;
- changing the adapter files or their replacement runs the product's tests on the real variant;
- in every run, a seed-selected share of tests goes on real variants; that share never comes from cache [[05af9265]].

A test green on the fast variant and red on the real one is a variant mismatch: it is fixed and the case added to conformance.

**Acceptance.**
- The run report shows the SQLite child-process count per world open: one writer, and the pool and checkpoint once per worker.
- The pool's and durability's contributions to the graph part's CPU and wall measured and recorded separately.
- Runs on real variants (on change and seed-sampled) stand in the standard scripts.
- The in-process-adapter decision recorded on the report: needed or not, with the figure.
