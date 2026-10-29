---
id: 01a0d5a2-cf9e-7843-99ce-d2bf42c25b2b
title: bun 1.4.2 releases a poll finalized inside Bun.spawnSync against spawnSync's private loop, and later spawnSyncs spin with their child a zombie
ord: 1
tags: ["research"]
fields:
  {
    "source": {
      "name": "bun",
      "ref": "1.4.2+744846f84 (oven-sh/bun#34069, fix PR #40078)"
    }
  }
edges:
  - kind: discovered-from
    to: 01a0d557-57ac-7933-91ac-35a2cfda2fc7
---
Observed on bun 1.4.2 (744846f84), macOS arm64, on this machine, 2026-09-24.

- `Bun.spawnSync` waits on a private uws loop and, for the length of the call, points the VM's loop handle at it. At tag `bun-v1.4.2`, `FilePoll::deinit` (`src/io/posix_event_loop.rs`) and `KeepAlive::unref` (`src/io/keep_alive.rs`) resolve their loop through that handle. A GC finalizer that runs inside the call therefore releases a main-loop poll against the private loop.
- That loop's `num_polls` then stays negative for the life of the process, and `us_loop_run_bun_tick` returns without polling when the count is 0. From then on, a spawnSync whose child exits after its pipes close never sees the exit. The child stays `<defunct>`, the caller spins on `clock_gettime` without ever calling `kevent`, and only a spawnSync `timeout` or a bun:test deadline ends the call. Inside a hook, or with no deadline, it never ends.
- `node:child_process` sync calls go through `Bun.spawnSync`, so they hit the same loop.
- Upstream: issue oven-sh/bun#34069 is open, and its fix, PR #40078, is open and unmerged. 1.4.2 is the newest tag.
- The PR's standalone reproducer drops three `Bun.stderr.writer()` sinks and runs with `BUN_JSC_slowPathAllocsBetweenGCs=5`. Here, its third spawnSync hit its 2 s timeout in 3 runs of 3. When a release carries the fix, that call returns `exitedDueToTimeout: false`.
- Stand-in measurements (the scripts were not retained): 30 `bun test --isolate --smol` files, stdio on pipes, where each file touches `process.stdout` and `process.stderr` and then calls spawnSync.
  - Without a GC: 7 of 51 runs wedged, 1 of 35 under `--parallel=1`.
  - With a preload that first runs `Bun.gc(true)`: 0 of 78.
  - Under the runlith preload: 1 of 24 wedged without the GC, 0 of 14 with it.

Not established:
- whether a finalizer from runlith's own test code, rather than from a retired global, ever runs inside a spawnSync;
- that the stalls in full server runs came from this mechanism. They were matched to it by stack and symptoms, and the finalizer itself was never caught.
