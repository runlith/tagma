---
id: 01a17c05-8bb1-7c87-b689-3ce41cbee90c
title: "The runtime world: 167 project births per 131-file run, birth cost before and after long-lived projection workers"
ord: 5
sources:
  - kind: file
    ref: apps/tagma/server/scripts/bench-project-birth.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/doorFixture.ts
---
Measurement of the "runtime world" part, 2026-10-27, Apple M2 Max, 12 cores, macOS 26, Bun 1.4.4. Neighbouring agents set the load; every number carries its load. Code before — HEAD `44ad37cc`, after — commits `ce28979789`, `fdfbf28165`, `95299b44af`. A/B ran in two separate worktrees off one HEAD, alternating.

## How many births per run, and where

A counting run of 131 door-world and terminal-world files (all files where the `integration-n8-pair` report says `testing/DoorFixture` or `testing/TerminalFixture`; those 131 files cost 821 of the run's 2145 CPU seconds). Preload counted `git init --bare … graph.git` and `add_project`/`remove_project` calls through the HTTP door, per testbed file.

- 167 stealth-project births in 122 files; 14 more — global's birth at every world build.
- By file: in 90 files one birth, in 25 — two, in 4 — three, one file each — 4, 5, and 6 (`socket/live`, `graphRemote`, `submitEqualLines`).
- Past one birth per file — 45. Nearly all sit in tests whose subject is two projects: `birthPlace`, `threadWork`, `settingsPlace`, `graphRemote`, `projectRename`, `projectCatalogs`, `adoptDoor`.
- `add_project` through HTTP — 154 times, `remove_project` — 64.
- Uncounted births via direct `ProjectLifecycle.create` in graph worlds: `copiedBlocks`, `farEdges`, `mirrorMove`, `routing`.

## One birth's profile

A quiet window (load 2–3), after a warming birth, own-process CPU:

| | before | after |
|---|---:|---:|
| the whole birth | 264 ms | 141–163 ms |
| `Graph.projectToTree` | 95 ms | 5 ms |
| `ShadowGit.answer` (in-process git launch) | 38 ms | 29 ms |
| `sql.execute` | 33 ms | 29 ms |
| `GraphPool.open` (own) | 22 ms | 21 ms |

- **Why the projection cost 95 ms.** A new project holds ~14 blocks, and nearly all the price was the cold start of a new `Worker` that `askOnce` raised per call. SQLite work per birth — 23 ms engine in 402 statements.
- **Git.** 29 processes per birth plus the fixture's `git init` — before and after alike.
- **Leaving.** `remove_project` launches no git and costs 10–100 ms.
- **The process's first birth** still pays the worker start: 105–126 ms in `projectToTree`.

`bun scripts/bench-project-birth.ts`, A and B alternating, 3 rounds of 3 births, load 4 to 12:

| | A | B |
|---|---|---|
| the `projectToTree` phase, warm births | 88–100 ms (one 184 ms) | 8–19 ms |
| process CPU, warm average | 294 ms | 238 ms |

Warm-average process CPU is noisy: load grew over the measurement.

## Hooks and tenant in the testbed report

The same 131 files, testbed-default workers. "Hooks" — as in the original 307 s number: the `file`-line `world` element minus the build cost from `world` lines.

| run | load | files CPU | hooks CPU | hooks wall |
|---|---:|---:|---:|---:|
| 1 A | ~16 | 400 s | 80.0 s | 73 s |
| 2 B | ~16 | 320 s | 63.7 s | 50 s |
| 3 A | ~20 | 402 s | 79.1 s | 62 s |
| 4 B | ~6 | 292 s | 55.0 s | 44 s |
| 5 A | ~8 | 316 s | 66.9 s | 47 s |

- **Hooks in neighbouring pairs** — minus 16.3 s (1/2) and minus 11.9 s (4/5) CPU over 131 files, i.e. −18…−20%.
- **No separate "before" for the full server integration:** the full set never raced. Other files' hooks depend on how many births and projections they hold.
- **The tenant line.** After `95299b44af`, the door world's project birth and leaving (`stealthProject`, `plainProject`, `knowledgeProject`, `projectLeaving`) is a tenant, like the graph world's tenant. Over three seeds after the change the tenant cost 49.6–60.5 s CPU (load 3–19) at 86 files, of which 18.9–24.6 s inside 42 test bodies. Other hooks — 23.8–29.4 s.
- **A runtime tenant's price** is about 0.5–0.7 s of its own process CPU per file, dividing the tenant over the files holding it. Plus git children on top.

## The choice

- **Fewer births** gives nearly nothing: births already run one per file or scenario. Past that — 45 births, and nearly all sit where the test's subject is two projects.
- **A copy of a born project at the fixtures owner** would mean writing past `add_project` the registry lines, policy, `meta`, the mirror, `graph.git` with its worktree, and also notifying the pool, the observer, the freshness gate, and the `ProjectChanges` subscribers. That would be a second birth implementation with the same product caches. No door registering an already-ready stealth storage exists in the product.
- **Producer-side cheaper chosen.** The birth CPU's largest chunk — starting a single-use projection worker — is paid by every user on every project add, tree delivery in steps, and `rewrite_graph_files`. How it works now: [[5b07b19e]].

## What stays at the producer

- **29 git per birth.**
  - Two topology syncs at opening (`attachTree` and after filling the mirror) twice read the checkout's refs and worktree and the `graph.git` refs.
  - The first freshness refresh repeats `rev-parse --verify refs/remotes/origin/main` and `config core.excludesFile`, already read by the second sync and the observer.
  - The serving-switch `commitAct` — 5 processes.
  - The repeats sit at different owners with their own invariants ([[2b689623]], [[94d69020]]). The win estimate — 5–6 processes per birth.
- **A worker per call** still at `graph/tree/settling.ts` (merge settling), `enforcement/commits/graphMerge.ts`, `graph/storage/identity.ts`, `graph/search/counting.ts`, `graph/steps/platformsDeclared.ts`. At `declaredNames` that is a memory decision ([[5d41f0fa]]). The rest are candidates for landing and enforcement files, unmeasured.
