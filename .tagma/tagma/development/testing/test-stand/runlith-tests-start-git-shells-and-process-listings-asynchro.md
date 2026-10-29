---
id: 01a0d5ab-dca5-7191-8cb1-3ddef89e06b0
title: runlith tests start git, shells and process listings asynchronously, and the preload's GC workaround for bun's spawnSync goes
ord: 23
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d5f0-7b56-7753-ae5f-c936f1fccbef",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d557-57ac-7933-91ac-35a2cfda2fc7
---
**Why.** The full-run stalls were bun 1.4.2's `Bun.spawnSync` spinning after a GC finalizer ran inside it ([[42c25b2b]]). The preload's `Bun.gc(true)` sweep (1227ccf8 (deleted with the sweep)) makes them rarer but not impossible. Removing synchronous spawns from tests removes the trigger. The operator decided on 2026-09-24: tests move to asynchronous spawns too. Per-call cost is unchanged, measured at about 20 ms either way for `git rev-parse`.

**Scope.**
- The test helpers:
  - `syncGit`, which should become the production asynchronous git service where the fixture can take it;
  - `git()`, `sh()` and `tempRepo()` in `graph/core/graphFixture.ts`;
  - the like in other fixtures.
- Every `*.test.ts` and `*.itest.ts` that calls `Bun.spawnSync` or `node:child_process` sync calls directly — about 85 files in `apps/tagma/server` alone, plus other bun packages.
- The preload's own listings in `test/residue.ts` and `test/layers.ts` (`ps`, `lsof`).

**Waits** on the renames of [[e37f221c]], so two agents never edit the same files.

**Done when:**
- no synchronous child-process call remains in runlith test code or its preloads;
- the GC sweep and its claim 1227ccf8 (deleted with the sweep) are removed;
- the touched suites pass, in pieces under the 90 s limit.