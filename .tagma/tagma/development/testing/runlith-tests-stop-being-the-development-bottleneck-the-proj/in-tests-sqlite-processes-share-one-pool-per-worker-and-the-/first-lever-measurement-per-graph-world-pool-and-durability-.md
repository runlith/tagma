---
id: 01a16b35-7986-792d-9861-9a7edb93871c
title: "First-lever measurement: per-graph-world pool and durability-free storage, the integration layer's graph part"
ord: 2
edges:
  - kind: discovered-from
    to: 01a16b08-3df5-7646-870f-b2aa7eb43056
---
**Total.** One `ProcessPool` per graph world halved the graph-integration slice's SQLite child processes, 1831 → 906, and took about 15% wall. Durability-free storage changes no process count. In back-to-back runs its contribution drowned in load noise; an alternating A/B showed −28% wall and −10% user CPU.

**How it was measured.** 2026-10-24, Apple M2 Max, 12 cores, 32 GB, macOS 26.0.1, Bun 1.4.3. Other agents loaded the machine in parallel: load average 8–19. Suite — 110 `*.itest.ts` files under `src/graph` and `src/composition/testing/graph`, three runs of 37/37/36 files, each `bun test --parallel=2`, back to back. Wall, user, and sys — `/usr/bin/time -l` over each run, summed. SQLite children counted with a preload that counts `Bun.spawn` with `sqlite-process/src/child.ts` per file. Each step one sample.

| Step | Wall | User | Sys | SQLite children | Per file p50 / p90 / max | Load (1 min) |
|---|---|---|---|---|---|---|
| Baseline | 294 s | 313 s | 143 s | 1831 | 13 / 35 / 59 | 12–19 |
| Pool per world | 247 s | 288 s | 129 s | 906 | 7 / 16 / 28 | 8–12 |
| Pool and no durability | 276 s | 298 s | 130 s | 908 | 7 / 16 / 30 | 10–14 |

Alternating durability A/B on one 36-file run (171 tests), pool in both arms, off-on-off-on order, load 5–11:
- without durability — wall 49.0 and 53.1 s, user 70.7 and 68.6 s, sys 35.2 and 35.2 s;
- with durability — wall 68.1 and 75.4 s, user 76.7 and 83.7 s, sys 41.4 and 43.1 s.

**What each step gave.**
- Pool. Earlier every world open raised a writer, reader lane, and checkpoint process, and the first also a writer and checkpoint for seed verification. The pool alone never changed that: reader and checkpoint processes died with the last connection. So `ProcessPool` gained a `'keep'` mode with `close()`, and `demoGraphLayer` holds such a pool for its layer's lifetime. Now one open costs one writer, while reader lanes and checkpoint rise once per world. Git process counts never changed (5233 → 5247): the product starts them.
- No durability. The store opens with `synchronous=OFF`, checkpoint runs without fsync, graph mirrors take the machine store's durability ([[3c17b3f1]]). That is disk-wait and syscall time, not processes. On macOS without `F_FULLFSYNC` the earlier `synchronous=FULL` cost little, and in back-to-back runs the effect sits below load noise.

**What remains.** The median is 7 SQLite children per file. Those are each open's writer, the graph mirrors' writers, and the world's reader lanes and checkpoint, which still builds per file. A per-worker pool from [[168725a4]] needs a per-worker world ([[ff15f336]]) and the kit watcher registering the world's processes ([[3e26831e]]): a pool that outlived a file is killed by today's watcher as a leftover. Pools of opens outside `demoGraphLayer` (`graphFixture()` directly, `seededStoreLayer`) still build per open.

**Failures this measurement never caused.** In all three steps one `composition/testing/graph/farEdges.itest.ts` test hits 10 s under load (file CPU 14.5–15.4 s); in a calm run it passes. In tests that use the graph world outside these 110 files, `enforcement/remeasurePasses.itest.ts`, `enforcement/baseMerge.itest.ts`, `enforcement/landing.stest.ts` (2 tests), `graph/serving/servingDrill.stest.ts`, and `threads/parityRequests.stest.ts` fail on the current HEAD. They fail identically without the pool and with durability — so not from this change.
