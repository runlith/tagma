---
id: 01a16be1-d3ed-720a-9f71-15d72cc5aee6
title: "The add_project profile: reopening the mirror and spare git reads at a project's birth"
ord: 2
sources:
  - kind: file
    ref: apps/tagma/server/scripts/bench-project-birth.ts
---
A profile of one `add_project` through the HTTP door in `makeDoorWorld`, 2026-10-24, Apple M2 Max, 12 cores, 32 GB, macOS 26.0.1, Bun 1.4.3. This is a recon measurement before the parallel performance-run ban; the delivery's shared baseline is [[3c13cbc1|testbed measurement]]. The runtime already built, a separate empty folder got `git init -q -b main`; the `git init` itself, the import, and the world creation sit outside the operation's boundary. Storage — stealth, directories — the machine default. The first and the next projects created back to back in one world, one sample each: the OS page cache and others' load uncontrolled.

## Product process

First call: **2167.3 ms wall, 952.2 ms CPU of its own process**; the next project of the same runtime: **1299.0 ms wall, 510.8 ms CPU**. Measured `process.cpuUsage()` and intervals of existing Effect spans, the tracer wrapped only in the prober. CPU includes the process's threads, including the projection worker; JS and native JSC not sampled separately by frames. Child git and SQLite excluded from this CPU.

First call, non-overlapping phase windows by process CPU:

| Phase | CPU, ms |
|---|---:|
| Installing catalogs into machine lines (`installCatalogs`) | 190.2 |
| The rest of machine-entry creation before opening the graph | 58.4 |
| Projecting lines into the tree (`Graph.projectToTree`) | 196.3 |
| The rest of graph opening: attach, SQLite carry-over, service assembly, observation, first settle | 479.1 |
| HTTP, admission, and the answer outside `ProjectLifecycle.create` | 28.3 |

`GraphPool.open` whole: 1770.6 ms wall / 675.4 ms CPU, projection included. That is interval attribution of process CPU, not a sum of functions' own CPU frames: background runtime landing in the window is not separated.

## Git

Inside the first call's boundary — **35 `Git.spawn`**, the next call — 35 too. The sum of those spans' intervals: 1041.3 and 794.8 ms wall. The git children's own CPU not taken in this prober.

27 commands went through `ShadowGit.answer`; their kinds kept: `init` — 1, `mktree` — 1, `commit-tree` — 1, `update-ref` — 1, `for-each-ref` — 5, `worktree` — 5 (four list reads and one add), `rev-parse` — 6, `symbolic-ref` — 2, `ls-files` — 1, `add` — 1, `diff` — 1, `commit` — 1, `config` — 1. Another 8 processes go through the Git kit; the first output did not keep their separate verbs. The full verb count is now given by the `scripts/bench-project-birth.ts` prober.

The birth signs and the code branch name are read twice before two topology syncs: `rev-parse HEAD^{commit}` and `symbolic-ref`. Between them the full ref list is already read, which knows whether the current branch is born.

## SQLite

First call: **328 observed `sql.execute`**, the `db.exec.ms` sum — **132.1 ms**, the wall-span sum — **308.9 ms**. Next: 327 statements, 73.2 ms engine and 145.9 ms wall. That is partial coverage: the main runtime's tracer wrapped, while a separate ManagedRuntime builds the store with its own context. Init and close SQL of the mirror store, including the re-read of the shape this delivery removed, excluded. `db.exec.ms` is engine time, not child CPU; the child's startup/close not taken separately.

Carrying over machine lines opened the mirror in a separate runtime, copied the lines, and closed it; then `MirrorBuilder` reopened the same file for serving. That is repeat product work the user also paid on adding a project.

## Chosen slice

`MirrorBuilder` now owns one lazy store for the whole opening: the line carry-over and the ready services use the same connection; failure and dispose close it after the services. Topology reads the branch name through the existing `treeBranch`, and takes the birth fact from the already-read refs. Removed one mirror-store open/close and four git commands per ordinary stealth-project birth. The registration contract, line carry-over, and ready observation kept.

The remaining catalog-installation work, the first projection, shadow Git creation, and the own tree are real one-time user work. At a test-world tenant's target price of tens of milliseconds this is grounds to consider a copy of an already-born project at the fixtures owner; no template built here. The exact remaining price comes from the quiet window.

## After the change

No isolated after: the lead stopped performance runs over machine saturation and set one shared measurement after all deliveries are ready. No speedup number claimed. For that window, from `apps/tagma/server`: `bun scripts/bench-project-birth.ts`. The command creates one runtime and three fresh projects back to back, prints separate wall/CPU phase windows, the git verb count, the SQLite connection/first-seen-pid count, and the partial statement set with engine/wall, marked with the coverage boundary. It launches no live server and frees its world. That is a diagnostic tool: its wrappers and the runtime's background work enter the process measurement.
