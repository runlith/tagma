---
id: 01a0d559-16ad-72c3-b569-eb528e7c936b
title: "Test layers are rules held by a runtime guard: a unit test touches no process, database, socket or disk, and runlith's impure unit files move to integration"
ord: 22
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0d4db-9d34-7461-807d-8775f5648cf9
  - kind: relates
    to: 01a0d556-c247-7d1e-b72c-3ae909744317
sources:
  - kind: file
    ref: apps/tagma/server/package.json
---
Third slice of [[f5648cf9]], in the components of [[ae56a980]]. A project declares its test layers as rules whose inspection is its own layer runner ([[50467aad]]). For runlith this decision also decides the content: what each layer may touch, the runtime guard that holds it, the runner, and the reclassification that makes today's unit layer honest.

## 1. Observable outcome

- In every runlith package that runs `bun test`, `bun run test` runs the unit layer only. For `apps/tagma/server` it answers in seconds, not minutes.
- A `*.test.ts` file that spawns a process, opens a SQLite database, opens a socket or writes to disk fails, naming the file and the kind of resource, whoever runs it.
- `bun run test:integration` runs `*.itest.ts` files. They may touch those resources only inside the run's own root, with a home and a network confined to it.
- `bun scripts/testLayer.ts` is the layer runner. It takes the program contract's input on stdin and prints violations on stdout: contract violations and failing tests. Until the engine exists it runs by hand, and afterwards `enforce_rule` names it.
- A project that declares no layer lands exactly as today.

## 2. Problem, with evidence

Measured on 2026-09-24:
- **A full server run** covers 2915 tests with 572 s of summed test time.
  - 1254 tests take under 10 ms, 2 s together.
  - 1169 tests take 100 ms or more, 548 s together — 96% of the time.
- **The unit layer is not unit.** Of the server's 362 `*.test.ts` files, 166 reach git, processes, temporary directories, SQLite or a listening server.
  - 83 of them build the graph fixture (`graph/core/graphFixture.ts`).
  - 58 of those open a fresh fixture in `beforeEach`, at about 120–230 ms per test: store copy and child about 26 ms, graph services about 40 ms, adding the demo project about 56 ms.
- **The split is not held.** The `.itest.ts` split exists only in the server (88 files) and the execution host (14). Nothing checks which file belongs where, and every other package keeps everything in `*.test.ts`.
- **What agents do today.** Because no layer answers in seconds, agents run the whole server suite, 2 to 5 minutes when it ends. Three runs on 2026-09-24 never ended. In the one sampled, a worker's main thread spun JavaScript on files that pass alone ([[cfda2fc7]]).
- **Chronic failures** in full runs teach agents that red is normal.

## 3. What holds now

- `test/noResidue.ts` → `test/residue.ts` is preloaded in every bun package ([[7b07b2a3]]). Under `--parallel` it runs per file ([[d4e78fbc]]). Each file:
  - lists the machine's processes with `ps -E`;
  - may run `lsof -u` to sweep dead roots;
  - moves `TMPDIR` into its own run root ([[b335365b]]).

  Its listings are bounded to 10 s since 2026-09-24. A listing that does not answer fails the file, naming the command.
- `test/noNetwork.ts` refuses non-loopback `fetch` and `node:http(s)`. It is preloaded only at the root and in `packages/llm` and `packages/agent` ([[a58d81b2]]). The server has no network guard.
- Nothing moves `HOME`, the XDG directories or Tagma's own home.
- Server scripts: `test` is `bun test src --parallel=6 --timeout 20000`; `test:integration` finds `*.itest.ts`.

## 4. Target model

### The layers, by what a test may touch

| Layer | File | May touch | Guarded |
|---|---|---|---|
| unit | `*.test.ts` | values, in-memory fakes of ports, reading repository files | yes |
| integration | `*.itest.ts` | one owner against a real resource: processes, git, SQLite, sockets on loopback, writing to disk | confined |
| system | `*.stest.ts` | the product assembled: server, execution host, app | confined |

- **Unit.** A unit file may not do any of the following. Each is a violation kind:
  - `process`: spawn a process through `Bun.spawn`, `Bun.spawnSync` or `node:child_process`;
  - `sqlite`: construct a `bun:sqlite` database or a `@runlith/sqlite-process` store;
  - `socket`: `Bun.serve`, `Bun.listen` or `Bun.connect`, `node:net`, or `fetch` to any host, loopback included;
  - `write`: write, create, rename or remove anything through `node:fs`, `Bun.write` or `mkdtemp`.

  Timers are not guarded. A test that sleeps is caught by the budget only if it burns processor time, which is a stated limitation.
- **Integration and system:**
  - `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` point into the run root, which carries Tagma's `~/.tagma` and every vendor CLI's saved login with them, since those are read through `os.homedir()`;
  - `GIT_CONFIG_GLOBAL` points at a file in the run root that carries a test identity;
  - Bun's install cache keeps its real path, so a child `bun` does not download;
  - network is loopback-only, through `noNetwork`, which every package now preloads.
- **Budget.** Each unit file has a processor-time budget, measured by the guard from its first line to its verdict. Processor time rather than wall-clock time, because wall-clock time beside dozens of sessions measures the neighbours. The figure is a parameter of runlith's unit rule, not of the engine. It is derived in step 1 as the p99 of the pure unit files' processor time in the inventory run, rounded up, and named with that measurement in the close; the operator may set another. A file past the budget is a violation of kind `budget`, carrying the measured value.
- **The residue guard runs only where a process can exist.** Unit files forbid processes, so they skip `ps` and `lsof` and the per-file cost of the listings.

### The guard

`test/layers.ts` is one preload, named in every bun package's `bunfig.toml` in place of `noResidue.ts` and `noNetwork.ts`. It:
- decides the file's layer from its name (`Bun.main`);
- for unit files:
  - replaces each guarded entry point before any test file imports it: `node:child_process`, `node:fs`, `node:fs/promises`, `node:net`, `bun:sqlite` and `@runlith/sqlite-process` through `mock.module`, and the functions on `Bun`. For `node:fs` only the writing functions are replaced, and reading stays.
    - Probed on bun 1.4.2 in a single file: named, default and promise imports are refused, and so are `Bun.write` and `bun:sqlite`'s `Database`; reading still works.
    - Not yet probed: `--parallel`, the runner itself, and modules that write while they load. Step 1 runs the guard in report mode over every package before step 4 refuses anything.
  - makes each replacement throw at the call, naming the kind, and records `<file> × <kind>`;
- for integration and system files: moves the homes, installs `noNetwork` and runs the residue verdict as today;
- appends every violation and every failed test as a JSON line to the run's report file, named by `RUNLITH_TEST_REPORT` when the runner sets it.

Limitation: a native addon or a worker thread that spawns on its own bypasses the replacement. The residue verdict still catches the process it leaves behind.

### The runner

`scripts/testLayer.ts`, run by Bun, speaks [[50467aad]]'s contract (`format: 'tagma'`, `needs: 'files'`).
- **Input:** a layer (`params.layer`) and the paths of the change.
- **Selection:** until the affected-tests slice lands, the files of the layer in every package the paths fall under. Afterwards, the query of `@runlith/code-facts` ([[ae56a980]] §5).
- **Tree.** The runner runs in `workdir`, which the engine hands it:
  - elsewhere, a detached worktree of `tree`, readied by the project's worktree setup;
  - at `work`, the caller's own checkout ([[50467aad]]).

  runlith's `worktrees.setupCopy` carries `node_modules` into a materialized tree ([[06ae746e]]).
- **Run:** `bun test` over the selected files with `RUNLITH_TEST_REPORT` set.
- **Output:** `{ tree: Violation[], base: [] }`. A contract violation's fingerprint is `<file> × <kind>`; a failing test's is `<file> × <test name>`. The base side is empty because a pre-existing failure is debt, not a base.
- It ends when bun ends. The execution host's limits bound it when Tagma runs it ([[ae56a980]], Runtime).

### Reclassification now

Today's impure unit files are renamed to `*.itest.ts` in this slice rather than carried as debt:
- a file that is integration by what it touches is integration;
- the unit layer is then pure and fast on the day the guard ships, which is the outcome agents need.

The move is mechanical:
- one package per commit, by `git mv`, with `reanchor_path` for the claims over each moved file;
- a file that mixes pure and impure tests moves whole, splitting it is optional follow-up work, and every such file is listed in the close.

The only debt left is failing tests. Each is a list entry — `{ file, test, owner, reason }`, with `owner` a standing task — held in `test/failing.json` until [[64798cd8]] can hold it as the layer rule's debt. The runner reports a listed failure as debt and any other failure as new.

## 5. Owners and boundaries

- **runlith test infrastructure** ([[7b07b2a3]]) owns the guard, the runner, `test/failing.json`, and the `bunfig.toml` and `package.json` scripts of every bun package.
- **Each package** owns the move of its own files. The integration suites keep their owners.
- **Tagma, in `enforcement/` and `@tagma/inspection`** ([[ae56a980]]) owns the layer as a rule, its run points, its budgets and the driver: the engine sections below. It knows nothing of bun.
- **The graph fixture's cost** is its own decision — the graph test stand, a sibling of this one. This slice only moves its users to integration.

## Engine sections (from the architecture thread)

### A layer is a rule

A test layer is a `#rule` whose inspection is a project program ([[50467aad]]): the project's layer runner with its runtime resource guard. One run answers two kinds of violations:
- **contract violations**, fingerprinted `"<test file> × <resource kind>"`;
- **failing tests**, fingerprinted `"<test file> × <test name>"`.

Both enter the same debt and escapes as any other violation ([[64798cd8]], [[f2755a5b]]). A chronically red test is a debt entry with an owner. A newly red test is new.

The layer's time budget is a measuring inspection in the same run. Its value is processor time per test file, stored in the debt entry, so a file already past the budget may not get slower.

### Where a layer runs

`at` gains `work`, beside `landing` and `merge` ([[64798cd8]]). The addition fits under `version: 1`, with no migration.
- **`work`.** The layer runs only when the agent asks: `inspect_work { layers: [<rule>] }` runs it over the tests the change reaches. It never runs on its own at landing. Its verdict is answered, not recorded as debt.
- **`watch` after landing.** For a layer rule at watch, the post-landing driver runs the layer over the landed change:
  - off every permit;
  - under the landing session's authority ([[50467aad]] §4);
  - wired in the same change as the gate ([[a00f91b0]]).

  A new failure or contract violation lands in the rule's `escaped`, raises `rule-escaped`, and is told to the author's thread through the existing delivery. This extends the re-measure driver of [[f2755a5b]].
- **`landing`.** Only by an explicit rule, inside the landing budget:
  - the budget is a project setting, 30 s by default within the operator's 30–40 s ([[be584b76]] §14);
  - `enforce_rule` refuses `landing-budget` when the measured run does not fit;
  - in practice a layer fits only once results are cached ([[ae56a980]] §5).
- **`merge`.** A full run of the layer over the branch, under the merge budget. The merge budget is the operator's figure; until he names one it is the project's command-rule time.

### Defaults a project gets by declaring a layer

- unit: `work`, plus `watch` after landing;
- integration: `watch` after landing, or `merge`;
- system: `merge`.

A project that declares no layer lands exactly as today.

## 6. Rejected alternatives

- **The 166 impure files as debt with a ratchet.** The unit layer would stay slow until each entry is paid, and the debt would describe files that are honestly integration.
- **A static import check for purity.** It misses a resource reached through a transitive dependency, a fixture helper for one.
- **A wall-clock budget.** On a machine running dozens of sessions it measures the neighbours.
- **A wrapper script as the only guard.** Agents call `bun test <files>` directly; only a preload reaches every run.
- **An in-memory store so graph tests become unit.** A second implementation of the store contract must agree with the first in everything. That is the graph test stand's question, not this slice's.

## 7. Acceptance criteria

- In each bun package, a `*.test.ts` file that calls each guarded entry point fails naming `<file> × <kind>`, and the same call in a `*.itest.ts` file runs.
- Calling `spawnSync` named-imported from `node:child_process` in a unit file is refused. So is `import { Database } from 'bun:sqlite'`.
- `bun run test` in `apps/tagma/server` runs no `*.itest.ts` file and ends in under 60 s of wall time on an idle machine. The measured figure is named in the close.
- An integration file reads `os.homedir()` inside its run root, and `git config user.email` answers the test identity.
- `bun scripts/testLayer.ts` fed a contract input:
  - answers the report of a planted violation and a planted failure as violations;
  - answers a failure listed in `test/failing.json` as debt;
  - exits non-zero on output it cannot build.
- The engine's cost of materializing a runlith tree, `setupCopy` included, is measured and named in the close.
- The unit budget's figure is named in the close with the measurement it was derived from.
- The residue verdict still kills and names a process an integration file leaves behind.

## 8. Claims and tasks this touches

- [[b335365b]], [[d4e78fbc]]: revised. The residue verdict runs for integration and system files only, and its listings are bounded.
- [[a58d81b2]]: revised. The network guard is part of the layer preload in every bun package.
- [[8b0f72c9]]: survives. Vitest packages stay out of this slice; see 15.
- The claims over the moved test files move with them: `reanchor_path` for each rename.
- `package-boundary`'s test-file pattern (`TEST_FILE`) gains `stest`, so system files are not walked as shipped code. The architecture thread revises [[15d47c9d]]'s layer-rule exclusion to match.
- The chronic failures each get a task named as their owner in `test/failing.json`.

## 9. Order of building

1. The guard in report mode over every bun package, and what it answers:
   - the list of files to move;
   - the pure files' processor time, from which the unit budget is derived;
   - any module that writes while it loads.
2. The home and network confinement for integration.
3. The renames, package by package, with the scripts.
4. The guard in refusing mode, and `test/failing.json`.
5. The runner.
6. The engine sections, after [[be584b76]] and [[50467aad]].

Steps 1–5 need no engine.

## 10. Contract

- The runner speaks `contract: 1` of [[50467aad]].
- `test/failing.json`'s entry shape is the debt entry of [[64798cd8]], so `enforce_rule` absorbs it as the layer's first debt.
- The report file's line shape (`{ file, kind | test, value? }`) is internal to the runner.

## 11. Stored data

- `test/failing.json` is committed and changes by review.
- Nothing is stored by the server until the engine sections; then [[64798cd8]] applies.

## 12. Who may do what

- Adding an entry to `test/failing.json` needs a standing task as its owner, the same rule as debt ([[64798cd8]]).
- Moving a file from unit to integration is an ordinary change.

## 13. Long-lived things

None: the guard lives for one file, and the runner for one run.

## 14. Bounded resources

- The unit budget: processor time per unit file, the figure derived in step 1.
- Listings bounded to 10 s.
- A runner run bounded by the host when Tagma runs it, and by the caller's command time by hand.

## 15. Rollout

- Package by package.
- An agent that names a renamed file by its old path finds no file. The package's rename commit names the new path.
- Vitest packages (`apps/tagma/app` and the others) are out: they already run in jsdom with their own setup ([[8b0f72c9]]), and a guard for them is a later decision.

## 16. Failures

- A guarded call in a unit file throws at the call, so the test that made it fails where it stands.
- A runner that cannot read the report answers exit 1, which the engine reads as `inspection-failed`.
- A stalled worker is ended by the host's limits when the runner runs under Tagma.

## 17. Observability

- The runner's output names every violation with file and kind.
- `test/failing.json` shows the standing debt.
- The engine's spans cover a run once Tagma runs it.

## Coverage of the brief

The areas touched are [[7b07b2a3]] (the preloads) and the owners of the moved files.

out: every other area — nothing else changes.
