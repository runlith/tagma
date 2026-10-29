---
id: 01a16eb1-9263-71d7-9fa6-8fe326f52110
title: "Bun 1.4.3 under bun test loses exit of node:child_process: the process is reaped, exitCode is set, emit('exit') never fires"
ord: 7
tags: ["research"]
fields:
  {
    "source": {
      "name": "bun",
      "ref": "1.4.3 (c6da4a4d3), .external/bun-1.4.3"
    }
  }
edges:
  - kind: relates
    to: 01a16e63-dd41-7533-993a-539ece21892a
---
Under `bun test`, Bun 1.4.3 (macOS, arm64) loses the `exit` event of `node:child_process`: the process is reaped, `child.exitCode` is already set, and `emit('exit')` never happens. Measurements of 2026-10-24 on this machine under shared load (load average 15–34), one pass each. Probes live in the x-enforcement thread scratch (`lost/files.ts`, `lost/plain.ts`) and aren't kept after it.

**Observation.** A probe plants 25 file pairs and runs them with one `bun test --parallel=1`. Every second file does `spawn('true')` and waits for `exit` for 3 s.
- `exit` didn't arrive in 4–11 of the first 75–100 `spawn` per file (6 passes). With the testbed preload the result is the same (10 of 100); `--no-isolate` — 2 of 75.
- A file with `spawnSync` before it isn't needed: without it, 11 of 100.
- For every lost one: `ps` doesn't see the pid (process reaped, not a zombie); `exitCode` = 0 already at second 3; after 4 s of waiting the event still isn't there. Intercepting `child.emit` saw only `spawn`. `uncaughtException`/`unhandledRejection` handlers caught nothing, and the runner reported no error.
- `stdio: 'ignore'` — 0 of 75; early reading of `child.stdout`/`child.stderr` — 1 of 75.
- `Bun.spawn(['true']).exited` in the same scheme — 0 of 100.
- Outside `bun test` no losses: 80 fresh `bun script.ts` processes and 80 `Worker`s — 0.

**Reading of the source** (`src/js/node/child_process.ts`, tag 1.4.3). Only `#handleOnExit` writes `exitCode` — native `onExit` calls it via `process.nextTick`. Between writing `exitCode` and `this.emit("exit", …)` it takes apart stdio: `#stdin.destroy()`, `#getBunSpawnIo(1|2, true)` with lazy `require` of stream modules. So `#handleOnExit` started and broke before `emit` such that the exception never reached `uncaughtException`. Where exactly isn't established; the link to `bun test` file contexts (`enter_context` in `Subprocess::on_process_exit`) is a hypothesis.

**What this doesn't establish.** The cause inside Bun and why stdio matters. Whether this matches the inspection-worker hang of [[ce21892a]] — there the same sign ("exit unseen, system: gone"), also under `bun test`, but through the Effect `NodeChildProcessSpawner` over `node:child_process`; no probe was put on it. The server outside `bun test` isn't touched by this probe.
