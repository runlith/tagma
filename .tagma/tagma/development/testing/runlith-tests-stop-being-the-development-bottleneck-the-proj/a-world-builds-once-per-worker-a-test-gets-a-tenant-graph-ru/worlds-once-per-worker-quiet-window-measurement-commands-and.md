---
id: 01a16c31-5b63-79fd-ae85-e32e7463242b
title: "Worlds once per worker: quiet-window measurement commands and world/process counts from correctness runs"
ord: 2
---
**State.** Worlds once per worker in progress since commit acecaa0b1b: server scripts run with `--parallel=2 --no-isolate`. Time and CPU after the change not yet measured. Per the 2026-10-24 decision, measurements taken once, in the quiet window run by the leading agent, with the baseline [[3c13cbc1]] as "before". Below are the commands for that window and facts from correctness runs. World and process counts do not depend on load, so they can be recorded now.

## Quiet-window commands

All commands run from `apps/tagma/server`; `testbed` is `../../../node_modules/.bin/testbed`.

- **Graph part, 110 files, one `bun test`:**
  `testbed bun test --parallel=2 --no-isolate $(find src/graph src/composition/testing/graph -name '*.itest.ts' | sed 's|^|./|' | sort)`
- **Whole server resource layer, 877 files (`*.itest.ts` and `*.stest.ts`):** 12 shards as in the baseline, three at a time; each `bun test` fits in 5 minutes:
  `testbed bun test --parallel=2 --no-isolate --shard=K/12 $(find src -name '*.itest.ts' -o -name '*.stest.ts' | sed 's|^|./|' | sort)` for K = 1…12.
- **Server unit layer:** `bun run test` — that is `testbed bun test src --parallel=2 --no-isolate`.

Each testbed run-report line now also carries:
- `worlds` in the run line: how many worlds built, by kind, and how many files took a ready world;
- one line per world taken;
- own worlds with reasons listed.

## What correctness runs show

2026-10-24, Apple M2 Max, under load from other agents. Ran `--parallel=1 --no-isolate --randomize`, 15–19 files per process.

- **Graph part.** 110 files in 6 processes. Each process built the graph world once, the rest of the files took it ready: 18 of 19, 16 of 17, etc. SQLite children per process: 3–10, 36 total for 110 files. For comparison, with a pool per graph world there were 906 ([[db93871c]]), 1831 in the baseline. `graph/serving/projects.itest.ts` raises 3 SQLite processes instead of 44. A tenant costs about 0.1 s CPU of its process per test: the layer graph over the template copy is still rebuilt, cause in [[1b5ffd68]].
- **Runtime world and terminal world.** 189 files in 13 processes. Usually a process builds 1–3 shared worlds — one per parameter set (`hostSourcePath`, `everySpan`, `drivers`). Own worlds taken by:
  - tests passing functions or layers (`models`, `decisions`, `quotaProviders`, `vendorWire`, `exposure`, `access`);
  - tests that declared a reason: write machine settings, enter accounts, install plugins, declare MCP servers, change `process.env`, write to the global project, read all active runs of the world, register the world's source checkout, or check world closing.

  1–12 such files per process; the report prints their list with reasons.

- **Server unit layer.** All 319 files in one process green on two seeds. The operation catalog builds once: 3 of 4 files took it ready.

Red in these runs is only what is red on HEAD, or in-file test order under `--randomize`; each such file checked alone with the same seed. 14 files outside the kit's baseline list:
- `accountsDoor.itest.ts`;
- `titleRoads.stest.ts`;
- `terminalDelivery.stest.ts`;
- `hookPlace.stest.ts`;
- `admission.stest.ts`;
- `reflectDoor.stest.ts`;
- `accountSelection.itest.ts`;
- `place.stest.ts` ("prepared key");
- `ownGit.stest.ts`;
- `graphFormat.stest.ts`;
- `protocolFork.stest.ts` — a live model answered differently;
- `approver.stest.ts`, `modelChanges.stest.ts`, `attention.stest.ts` — one extra test in files already on the kit list.
