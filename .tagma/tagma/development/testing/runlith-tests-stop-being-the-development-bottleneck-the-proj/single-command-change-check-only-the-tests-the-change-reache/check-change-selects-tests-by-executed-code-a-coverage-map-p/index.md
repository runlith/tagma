---
id: 01a17d59-bc14-715f-8f98-e74051be9c36
title: "check:change selects tests by executed code: a coverage map per test file, taken process-per-file"
ord: 5
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a17d50-1adb-7b92-a7d7-14d148e75e13
sources:
  - kind: dir
    ref: scripts/change
---
**Why.** `check:change` selection by import graph barely narrows on modules the whole server loads: editing six `packages/agent-tools` files selected 563 files (≈1870 CPU-s), one `change-record/record/roles.ts` — 523. Such a run on a loaded machine does not fit the command's life, gets killed, and leaves not one result. Measurement [[48e75e13]] showed the changed lines of that edit executed ≈42 of 563 files (≈46 CPU-s), including the one red on it. The goal is selecting tests by the code they execute, not the code they load; checking an edit in such a module costs seconds, not tens of minutes.

**Map.** For every test file the map keeps:
- its import closure at taking time;
- every source the file's process loaded, with a content stamp (sha256);
- the lines of that source the file executed;
- the result: the map takes only from a passing file.

Source texts sit beside by stamp, to compare against the current ones later. The map lives in the machine's `check:change` cache, shared by its worktrees, in per-run deltas like the load trace ([[504fa5da]]): two concurrent runs lose none of each other's entries. The map directory changes together with the code writing and reading it, and the Bun version.

**Who takes the map.** A dedicated `check:map` command: every test file with no valid map goes as a separate process through testbed with `--coverage --coverage-reporter=lcov`, on the machine's shared budget, through the same `runJobs` scheduler. Bun itself translates the executed into source lines. A file whose inputs changed during the run gets no map.

Rejected:
- **A snapshot inside the shared `--no-isolate` process.** Bun 1.4.4 exposes `Profiler.takePreciseCoverage` via `node:inspector` with per-snapshot counter reset, i.e. per-file coverage with no own process. But positions are in the runtime-transpiled text, which cannot be obtained: no `Debugger.getScriptSource`, and `Bun.Transpiler` with `target: 'bun'` matched the runtime in 689 of 1643 files over the `composition/runtime.ts` graph. And most importantly — in the shared process, code one file executed and remembered (a shared world, the module cache) the next file does not execute and misses in its own map. An edit of such code would not select a file depending on it — a false green already rejected for the load trace ([[504fa5da]]).
- **Coverage over a one-process file group.** Safe, but a group's union nearly always contains the changed code: the selection stays wide.

**How `check:change` selects.** Candidates are the current import-graph selection, with all its rules (shared inputs, non-sources, unparsed `import()`). A candidate stays selected when at least one holds:
1. the test file itself changed, or it has no map;
2. the map is stale: a source the file executed changed since taking, in the executed lines;
3. the changed path is not a JS/TS source, or the file loads it only through a Worker or child process;
4. the file loaded the changed source, and the edit touches an executed line. The edit compares against the by-stamp text from the map, so others' changes since count too. An insertion touches neighbouring lines; a top-level module insertion or deletion, except side-effect-free declarations, touches the load and selects everyone who loaded the module;
5. the file's import closure grew since taking, and the new modules include one with a top-level side effect.

Otherwise the file is not selected, and the output names the reason: the map from such-and-such run, the file executed none of the changed lines. An edit changing only types, comments, or formatting selects nothing by the map: typecheck checks it.

Modules the process loads but with none of the changed lines executed never enter the selection. JSC marks `class X {`, `constructor(...)`, and a `Effect.fn(...)(function* ...)`-style call's closing line executed already at load. An edit on such a line therefore selects everyone who loaded the module: caution, not loss.

**Freshness.** A map holds until stale by rule 2. A stale map does not narrow the selection: the file goes by import graph. `check:map` retakes only missing and stale maps. How fast maps age under hundreds of daily landings is unmeasured: part of the acceptance.

**What map selection misses.** A file whose source the edit changes though it executed none of the changed lines: a branch picked by data absent at taking; time- and order-dependent coverage; Worker and child-process loads (they stay under rule 3). The full run catches that, and it is also the source of fresh maps.

**Boundary.** Only `scripts/change` and the `check:map` script in the root `package.json` change; the Tagma product and testbed do not. The `tests` skill and the check section in `AGENTS.md` describe map selection in the same work.

**Taking the full map.** Taking from zero is a process per file, one `check:map` command; rule [[5c30294c]] forbids taking it in parts. It is rarely needed: on a Bun or map-code change. After that `check:map` takes only missing and stale maps. On 2026-10-27 the operator accepted about 13 minutes for a from-zero taking for per-file accuracy. Measurements sit in the note under this spec.

**Acceptance.**
- On the bash-glob-authorship edit (paths from [[48e75e13]]) with maps of all candidates, `check:change --plan` selects at most 60 files. Among them `composition/testing/change-record/commandMoves.itest.ts`, and every unselected candidate named with its reason.
- The full map taken by one `check:map` command within the command's life.
- On the commit sample [[2809e291]] no test the commit itself turned red in the full run is skipped by map selection.
- An edit changing only types or comments selects no file by the map; a new top-level calling instruction in a module selects everyone who loaded it; a stale map returns the file to import selection with a reason.
- Recorded in the note under this spec: map-taking CPU and wall vs the full run in shared processes, and the stale-map share after consecutive landings of one working day.

**Left after [[cfc750ae]].** Selection on bash-glob — 88 files, the 60 bar not taken. The [[2809e291]] sample run over commits not done: the false green checked on one commit (`e765fc0`, 477 files outside the selection, none red). The working-day stale-map share unmeasured.
