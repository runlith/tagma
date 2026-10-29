---
id: 01a16bfa-f686-763e-8177-968fc46fbf55
title: Built-runtime background passes and build profile, 2026-10-24
ord: 2
sources:
  - kind: file
    ref: apps/tagma/server/scripts/profile-runtime.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/drives.ts
---
The inventory is a static code reading on 2026-10-24 plus the `apps/tagma/server/scripts/profile-runtime.ts` prober. The profile is one sample under other agents' load, taken before the measurement ban: figures show shares, not a norm.

## How passes start

Passes stand inside module installation, serving, and workspace layers. Ones that became drivers are named by the module in its manifest (`drivers: [{ id }]`), and its layer offers the pass through `drive(id, pass)` from `platform/contract/service/drives.ts`. `makeRuntime` holds the offers until serving-stack build ends and starts the selected ones in the offering layer's scope and context: `drivers` unspecified — all, `[]` — none. A layer built outside `makeRuntime` (unit fixture) starts the pass at once, as before.

Test worlds never open maintenance: only `composition/server.ts` calls `openMaintenance`. So passes waiting on `Maintenance.opened` never run in worlds at all.

## Drivers — 24, in their modules' manifests

| id | module | when | what | processes |
|---|---|---|---|---|
| `remeasure` | enforcement | graph-copy open; at maintenance open — opening remeasure and landing replay | rule remeasure | git, inspection workers |
| `commit-hooks` | enforcement | maintenance-open, only with `commitGate` | sets the commit gate in registered checkouts | git |
| `editors-search` | editors | build | installed-editor search | `osascript` on macOS |
| `sandbox-sweeps` | sandbox | after boot-condemn, then 15 and 2 min | engine drift, release | docker CLI |
| `root-healing` | workspace | build, then daily | retired dead roots | git |
| `commit-trees-sweep` | workspace | build | sweeping commit trees of vanished checkouts | git |
| `navigation-sweep` | navigation | every 30 s | engine measurement, resting idle worktrees | — |
| `stalled-runs` | native-harness | every 60 s | stuck-run log | — |
| `compaction-calibration` | native-harness | build, then 30 s | compaction-calibration save | — |
| `native-sweeps` | native-harness | maintenance-open, then daily | retention and row rollup | — |
| `notification-retention` | notify | build, then hourly | old-notification delete | — |
| `push-retention` | push | build, then 10 min | old push-receipt delete | — |
| `request-key-retention` | executions | build, then daily | request-key retention | — |
| `terminal-grant-closes` | executions | every 5 s | terminal-grant close retry | host RPC |
| `terminal-disposition` | executions | every 5 s after boot | terminal disposition; first boot pass stayed in boot | host RPC |
| `browser-idle-pages` | browser | every 10 s | idle-page release | — |
| `rights-renewal` | access | build, then daily | rights-document renewal | HTTP, if a token exists |
| `holdings-warm` | change-record | build | Holdings-judge warmup | git, line-walk worker |
| `text-collection` | change-record | on reference release | unused-text collection | — |
| `text-sweep` | change-record | maintenance-open, then daily | text sweep | — |
| `trash-sweep` | checkout-files | maintenance-open, then daily | checkout-trash | git |
| `thread-sweeps` | threads | maintenance-open, then daily | rollout projection, forming, history | journal worker |
| `rollout-shelving` | threads | maintenance-open | rested-rollout offload | rest worker |
| `said-backfill` | threads | maintenance-open | said backfill in SQL | — |

## What stayed in layers and why

- **Subscriptions that keep a service consistent** — caches, feeds, invalidations. The service's answer is wrong without them; that is no maintenance:
  - change-record: authorship, judges, heads, run marks, retirement triggers;
  - graph: pool, journal feed;
  - threads: list, events, settlements, approvals, recap;
  - agent core: settlement recipients, scheduler, sender wakes;
  - navigation: policy, marks;
  - executions: endings, inventory, custody;
  - external-harnesses: session and protocol lease, every 5 s;
  - native-harness: quota, start card, account and limit republish;
  - push and notify delivery, schedule, access, mcp, speech (project offboard);
  - workspace (checkout paths).
- **Invalidation and recovery that answers stand on** — after review left out of drivers: copy close and coverage reconcile at remeasure (otherwise `Remeasure.ready` would answer with a stale ready remeasure after reopening a copy), sandbox boot-condemn (otherwise unfinished preparing/building would never transition and would overlap new ones), conversation-index catch-up (`search_threads` reads only the index). Also:
  - change-record: git metadata, write intents, command windows;
  - executions boot: waiters, endings, inventory, first disposition;
  - commit-queue journal;
  - speech boot on `Handoff.opened`;
  - row retirement: opening pass and its listeners;
  - landing and worktrees, on maintenance-open;
  - thread resource release (afterRecovery);
  - run reaper — its `recoverRuns` is called by `server.ts`.
- **Entry process** (`composition/server.ts`, not `makeRuntime`): serve-log limit, recovery and maintenance opening, CLI integrations, plugin start.
- **Packages outside the server:**
  - activity: retention every 5 min, flush, body worker;
  - performance: CPU sampler window, loop stalls;
  - sqlite-process: child pool.

## Runtime world processes

Prober: `makeDoorWorld` plus `stealthProject`.
- 12 SQLite children (`packages/sqlite-process/src/child.ts`).
- git: 2 at global-project birth and about 36 at `add_project` — `GraphPool.open`, freshness, checkout watching, `enforcement.headOf` of the `remeasure` driver.
- Watcher (`packages/watch/src/watcher.ts`) — on the project's checkout-watch demand, not a driver.
- `osascript` — `editors-search`.

`ps` and `pgrep` are spawned not by runtime but by the execution-host door-fixture producer (`FixtureProcesses.end`) at the world's close. Plain runtime with `drivers: []` spawned only the SQLite children and 2 git of the global-project birth.

## Runtime build profile

Same input as `makeDoorWorld`. Apple M2 Max, load average 25–33 from other agents' tests.

- **Own-process CPU** (`process.cpuUsage`), 5 runs: import 0.9–2.1 s, `makeRuntime` 2.1–9.2 s; in the profiled run 1.87 s and 5.94 s.
- **Why `bun --cpu-prof` is empty.** The performance package's CPU sampler holds the inspector and stops another window. So the profile is taken through `node:inspector` in the process itself and stops before runtime closes.
- **Build window.** Main-thread samples covered 1.65 of the process's 5.94 s CPU; the rest — GC, workers, and native module loading. Shares of sampled:
  - SQLite IPC (`receive` and the client's `ipc`) — 34%;
  - performance telemetry (`PerformanceTracer.spanByteSize`, `LoopStalls`) — 6–11%; `spanByteSize` serialized every sampled span to JSON for length, now the length is computed from parts (22e1caab1b), the result byte-for-byte the same;
  - migrations — about 1%: a fresh base copies the seed;
  - the rest — layer builds: threads 7%, graph 7%, platform 4%, agent core 4%, external-harnesses 4%, composition 3%, native-harness 3%, providers 2%.
- **Drivers and processes.** On the main thread they are small at build; their cost is in children (SQLite, git, `osascript`) and idling. 3 s of idling took 0.28 s CPU. Largest — one fiber that rebuilds the context cache on every tick (`makeFiberContextCache` from `setContext`) and the external-harness session heartbeat lease (`sessions/lease.ts:172`).
- **Module loading.** Importing `runtime.ts` loads about 2000 modules: 17.9 MB of source, of it effect — 11 MB in 320 modules. Build lazily loads about 1270 more (7.5 MB). Speech (audio-file, speech, and engines), browser (cdp, managed, and desktop browser), and models (adapters) together — about 1.7 MB, roughly 7% of loaded source.

Never established: each driver's share of the world CPU and children CPU by article.

## How to retake

```
cd apps/tagma/server
bun scripts/profile-runtime.ts --world --out=<world.json>
bun scripts/profile-runtime.ts --profile=<all.cpuprofile> --out=<all.json>
bun scripts/profile-runtime.ts --drivers=none --profile=<none.cpuprofile> --out=<none.json>
bun scripts/profile-shares.ts <file>.cpuprofile
```

`--modules` writes the module load order.
