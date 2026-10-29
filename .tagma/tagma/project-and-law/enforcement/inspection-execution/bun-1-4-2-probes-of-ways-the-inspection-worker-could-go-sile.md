---
id: 01a1205b-eb84-7eac-af15-ef0cd9aef9cf
title: "Bun 1.4.2: probes of ways the inspection worker could go silent — none reproduced the hang"
ord: 2
tags: ["research"]
fields:
  {
    "source": {
      "name": "bun",
      "ref": "1.4.2"
    }
  }
---
Probes on Bun 1.4.2 (macOS, arm64, 32 GB) on this machine; scripts lived in the session scratch and aren't kept, so the results don't reproduce from the record. Each probe looked for one way the inspection worker could go silent with no CPU and an unanswered request.

**A message to a `Worker` before it attached its listener.**
- A worker module with a top-level await, listener after `await`: a message sent right after `new Worker()` lost 5 of 5. With a heavy synchronous import before the listener — delivered 5 of 5. Bun loses such a message only when the module computation is asynchronous.
- `judge.worker.ts` from sources: first message delivered 4 of 4, and 4 of 4 with `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`.
- Built `judge.worker.ts` from the server install (one file, 7.5 MB): 12 of 12; 6 workers at once with a main thread busy for 2 s and six `yes` processes — 90 of 90.

**An answer that can't be sent.** `postMessage` with a function inside `.then` throws `DataCloneError`: the parent gets `error`, then `close`. The queue sees such a breakage and fails the request — it doesn't turn into silence.

**`exit` events of `node:child_process`.** The main thread and three workers ran `git rev-parse` in parallel for 40 s (six launch threads in each, about 25 thousand `spawn`) and `spawnSync` (about 4.4 thousand): `exit` arrived for every launch.

**Async `oxc-parser` parsing.** `importSitesOffThread` in a worker, four parallel parse threads, 6 rounds over 8113 repo files: all promises completed.

**Dynamic `import` of check packages.** `ready()` for three packages in five fresh workers at once, transpiler cache off, 12 rounds: every `import` completed.

**File descriptors.** Bun raises the soft `RLIMIT_NOFILE` to 1048576; the server in quiet state holds about a hundred.

**Git through Effect `node:stream` adapters in workers (October 10).** Three workers ran `@runlith/git` and `@runlith/code-facts` code from sources with the `BunChildProcessSpawner` layer, every fifth request in a fresh worker, the main thread busy 25 ms of every 100. First pass: 1920 requests, each — `rev-parse`, three `cat-file --batch -Z` with stdin, `ls-tree` by paths, a `cat-file` session and async oxc parsing. Second: 817 requests, plus a full `ls-tree -r` (megabytes of output), `git grep` and `cat-file` on 200 objects, while the worker's JS stood synchronously busy up to 250 ms — pipe pressure and read pause. Not one hang; 20 s threshold, on trigger — polling the worker for unfinished waits and `ps` on their pids. Scripts not kept.

**What the Bun 1.4.2 source says (tag `bun-v1.4.2`).** Process exit on macOS is waited via kqueue `EVFILT_PROC`/`NOTE_EXIT` with `EV_ONESHOT` (`src/spawn/process.rs`). If the event handler re-enters `us_loop_run_bun_tick`, the inner tick overwrites the shared `loop->ready_polls`, and the outer pass silently loses the rest of the batch (`packages/bun-usockets/src/eventing/epoll_kqueue.c`, no guard); a lost one-shot exit never comes again — on Linux it was closed by moving to level-triggered pidfd, on macOS left. Re-entry comes from `wait_for_promise`/`auto_tick`: entry point, preload, macros, synchronous `Bun.build`, `bun test`, debugger; `Bun.spawnSync` ticks a separate loop. No such call found in inspection-worker code, so this loss path isn't proved for the hang. `BUN_FEATURE_FLAG_FORCE_WAITER_THREAD` is read only when set and `BUN_GARBAGE_COLLECTOR_LEVEL` is set, and the wait thread on macOS stands in `sigwait` with an empty mask — not a bypass.

**What the probes don't establish.** What the silenced worker waited for. No probe reproduced either an event loss or a hang; a rare race under real-server load isn't excluded: in telemetry over two days — over a dozen server starts — one hang, and over the last day it is one in 174 `submit_work` calls ([[a2afe539]]).
