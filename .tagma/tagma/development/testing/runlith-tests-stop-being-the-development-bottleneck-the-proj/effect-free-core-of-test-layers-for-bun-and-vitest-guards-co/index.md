---
id: 01a16ac4-44bf-7e0a-8178-b7003e26831e
title: "Effect-free core of test layers for bun and vitest: guards, cost-breakdown report, cheap watcher that knows the world's processes, and each file's cost by category"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: dir
    ref: packages/effect-test
  - kind: dir
    ref: packages/testing
  - kind: dir
    ref: test
---
**What.** A kit package, `@runlith/testbed` (`packages/testbed`) — the core of test layers. It took `test/layers.ts`, `test/residue.ts`, `test/noNetwork.ts`, and `test/vitestResidue.ts`: the `test/` directory no longer exists, one implementation serves both runners. `@runlith/testing` stays Svelte helpers; its jsdom setup moved into this package's vitest binding.

**Package inputs.**
- *Core* — preload, bare TypeScript with no dependencies: it loads before every test file. Today preload costs 6 ms CPU on an empty unit file, while importing `effect` costs 27–80 ms CPU; for 780 non-Effect test files that would tax every file.
- *Worlds* — the world registry on Effect ([[ff15f336]]); loaded only by a file that takes a world.
- *In-memory adapters* that need a shared home — e.g. `FileSystem` with state ([[4dbd9a84]]).
- *Bindings* — bun (preload from `bunfig.toml`) and vitest (setup file and global setup in the app and 11 vitest packages' configs: `layer`, `query`, `primitives`, `chat-ui`, `code-editor`, `markdown-editor`, `i18n`, `seam`, `scroll-follow`, `error-boundary`, `desktop-host`). Today these packages have no guards, no closed network, and the process watcher stands only at the app. A vitest unit test that writes to disk or opens a socket starts failing at the call site; such tests are sorted out by [[4dbd9a84]] in the same work.

**Two file kinds.** Unit — guards refuse process, disk, socket, and SQLite at the call site, as today. `*.itest.ts` — a mark "real resources allowed", not a cost tier. There is no `*.stest.ts` suffix.

**In the core.**
- guards and a closed network, as today;
- environment isolation (HOME, XDG, git identity, TMPDIR) and a process watcher;
- a run report, always, into the run file. One row per test: file, test, body CPU and wall, tenant acquisition CPU and wall, outcome. One row per file: world (built here or taken ready), guard, children by kind (SQLite, git, other — count and CPU), total. One row per worker: its file sequence, built worlds and their cost. One row per run: wall and CPU of the whole suite against the parent spec's goal. The budget, [[05af9265]], and the parent spec's measurements read it.

**The watcher is cheap and knows the world's processes.**
- Today a file with resources makes the watcher listen to `ps -E -ww -Ao …` for the whole machine twice (`test/residue.ts:241,249`), polls the leftover up to 8 s in 100 ms steps (`:283-285`), and on dead roots calls `lsof -u` (`:173`); the reviewer's measurement — `ps -E` 0.04–0.05 s CPU, `lsof -u` 0.18 s CPU, one sample. `prepareEngine` hashes the SQLite archive and library in every process (`packages/sqlite-process/src/engine.ts:12-19`). File CPU is counted before the verdict (`test/layers.ts:331` vs `:353`), so the guard's cost never lands in the report. From now on it does: the suspects are its own spawns and their process groups (`residue.ts:196-217` already remembers them), not the whole machine, listing without spawning a process for the list where possible; the engine hash is verified once per run.
- The preload `afterAll` hook in Bun walks every file, and Bun never reports a worker's end (`parallel.mdx`: "a worker never knows which file is its last"). So the world registers its processes with the watcher: at a file's end they are no leftover; at the worker's exit the reaper removes them, and whatever outlived the exit is found by the next run's `sweep` by the `RUNLITH_TEST_RUN` mark. A process spawned by a test, not by a world, is judged at the file's end as today.
- A guarded call is judged as the work of the file that started it, not the file the worker runs now: the Bun binding runs each test and hook a file registers under that file in async context, which Effect 4 fibers keep across fork and yield. So under `--no-isolate` a shared world's background work running into a later unit file is its builder's: not refused, held with the world, not that file's leftover; the unit file's own calls are refused as before. A call with no recorded author (module top level, Vitest) is the current file's.

**Cost per file, no failing budget.** The parent spec decided on 2026-10-26 that a test fails only on its own fact: no run-failing file budget; a test past its kind's threshold passes and lands in the report as a `slow` line with its cost and cause. A file's items — load, guard, world, tenant, body — sum to its total; a shared world's build falls in the `world` item of the file that built it and stands on its own world row naming that file, so a reader separates placement from the file's own cost. `RUSAGE_CHILDREN` counts only reaped children, so the kit measures live world children by their pids.

**Order.** Package scripts keep declared order; the drivers choose it. `check:change` runs every set with its variant's `--seed`, `test:all --randomize [--seed N]` shuffles, testbed prints the seed whenever a run is shuffled, and a test file written or changed passes alone on three seeds (tests skill). `--timings` with `--update-timings` puts the slowest files first and splits them by time (`parallel.mdx`, "Balancing with --timings"). A layout is replayed from the report's worker sequence.

**What the core does not solve.** Whether a test belongs at all — junk, patch pinning, mock bookkeeping — stays with review under [[4f387de2]].

**Acceptance.**
- Today's guard checks (`test/guard.stest.ts`, `test/layers.itest.ts`) rewritten against the core as itest files, passing for both runners; a process left by a test still fails its file, a world's process does not, and one that outlived the worker's exit is picked up by the next run.
- In one worker under `--no-isolate`, a shared world's background process started while a following unit file runs is neither refused nor that file's leftover, while the unit file's own call is refused.
- A vitest unit test writing to disk, spawning a process, or opening a socket fails at the call site naming the file and resource kind.
- Under `--no-isolate`, the mode every suite script runs in, an empty unit file costs no more than 10 ms CPU with preload, and guarding a resource-using file with no child processes no more than 10 ms CPU; the number stands in the file row's `guard`. An `--isolate` run is not held to it: about 10 ms per file go to Bun recreating the guarded builtins in each fresh global, which the kit cannot make lazy.
- The report is written by both runners and carries four cost categories per file; the parent spec's baseline is taken with it.
- A test fails only on a hang; a slow test passes and lands in the report with its cost by category and children.
