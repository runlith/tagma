---
id: 01a16bdc-7718-7e04-b45c-3fc72809e291
title: A ten-commit sample for checking the selection and cost of the current tree
ord: 2
---
The sample is fixed before the measurement: the last ten commits whose changed live files, except Markdown and graph storage, belong to one–two current module cards. History taken from `9f0891dd7ad9ff3e5b6f3c079a8d7c7a837695de`; the membership checked against the cards at read time. The checkout is shared and moving, so the current tree is measured over these commits' path lists, not each commit's historical state.

| Commit | Modules | Full-comparison packages |
|---|---|---|
| `9f0891dd7a` | installation | apps/tagma/server |
| `6dba818936` | agent | packages/agent |
| `ba45e2e45c` | installation, release-channel | apps/tagma/server |
| `07f5f3aeba` | @runlith/highlight | packages/highlight |
| `3559b2ad01` | native-harness | apps/tagma/server |
| `efdec04347` | @runlith/activity | packages/activity |
| `1b8137cbf9` | composition | apps/tagma/server |
| `24543855d0` | @runlith/testbed | packages/testbed |
| `8aedb4a6e3` | @tagma/demo | apps/tagma/demo |
| `a50135189c` | @tagma/demo | apps/tagma/demo |

The full run is unit and resource, including the current `*.stest.ts`. By the lead agent's later order the wall/CPU comparisons stop until a shared quiet window; the "before" is [[3c13cbc1|kit baseline]]. The 20× goal unconfirmed. The server full run is reused between samples only with unchanged inputs. The current tree's speed proves nothing about a historical commit's cost.

**Selection.** For nine paths from `~/.tagma-dev/scratch/01a16bd1-a03a-7f0a-8458-7a7968f656cd/changed-paths.txt`: the cards gave 1097 server files, the allowed import closure — 642, the final conservative selection — 683. Another 41 files selected by cards because their graph holds a non-literal import. 222 server tests reach `composition/runtime.ts`. That is the current tree under parallel edits, not historical states' numbers. Shared-world files still pull a large share of the server; no 20× from selection alone is established here.

At first `--plan` wrongly built the keys of all selected tests, parsing one source over and over; the fix moved it to one reverse walk and a content-keyed node cache. The old card probe after removing keys from plan answered in 5.514 s at peak RSS 109 MiB; the first cold import index — in 18.0 s at peak 1041 MiB. These two diagnostic observations are no delivery performance comparison. The cache keeps one probe per current-inventory path; it keeps no AST or past revisions.

**Known red tests.** Inclusion checked by commit paths: `07fab0fd62` → threadSlot.svelte.test.ts; `3a2366a0bf` → composition/handles.test.ts; `685cccfc5a` and `7e6d9ec276` → composition/places.test.ts; `7e6d9ec276` → graph/serving/servingDrill.stest.ts; `73d0942f3313` → composition/testing/threads/parityRequests.stest.ts; `a480bfab79` → enforcement/baseMerge.itest.ts; `b4579ee614` → enforcement/landing.stest.ts; `32806c858e` → composition/testing/enforcement/remeasureStart.itest.ts; `87b1ff86ac` → composition/testing/native-harness/graphTools.itest.ts. All ten pairs included by import reach. That checks the current graph, not a replay of the historical failures.

**Cache.** The key is coarse: all input files of its own and reached workspace packages, including TS, other files, and fixtures; the lockfile, Bun/git/cargo versions, testbed preload, migrations, installed SQLite/watch/holder/relay artifacts, the seed, and the adapter mark. Dependency directories and the build's working results are not walked; installed native artifacts added explicitly. In-process reading noticed outside the key's packages and the stand's dedicated run directories, files, and worlds makes a file uncacheable; belonging to isolated directories is checked by canonical path, so a link outward becomes no exception; an unnamed external input is declared in the package's `changeCheck.externalInputs`. A child process or native code alone does not switch the cache off. The residual risk is unnoticed reading, e.g. a child process's absolute path into another package or a Bun external dependency's ESM builtin. `--no-cache` and the CI's isolated full run bound it. The `--adapter` mark does not select an adapter: current fixtures have no such switch; it names the externally configured variant and switches the cache off.

**Command checks.** Its own resource file with five contract tests passes: selection, conditional testing exports and dynamic import, a generated entry matched against the declared source, a kept index's edge change, and key invalidation. An earlier exact rerun of one checked file through the command gave 0 launched files and 1 cache hit. The generated-entry defect is proven red before the fix and green after. One Vitest file `packages/error-boundary/src/reporter.test.ts` passes the same way. The Bun `--changed` probe is in [[fd75347c|measurement-bounds note]]. An independent reviewer found the wrong runner selection for a mixed package, a skipped `.fixture.ts`, and a green total with no per-file report; the causes fixed at the selection and result owners.

**Quiet-window commands.** For each table row substitute `C` and `P`; when the packages match, one full run suffices with unchanged inputs. Each command uses one worker, the server splits into 12 `--shard 1/12` … `--shard 12/12` commands, other packages — 1/1; when one command does not fit, the part count grows, the command limit stays. `/usr/bin/time -p` measures the whole command with selection and hashing; the command's JSON gives runner reports. Selection without reuse and a cached rerun compare separately.

```sh
/usr/bin/time -p bun run check:change --full --package P --no-cache --shard K/N --report FULL.json
/usr/bin/time -p bun run check:change --commit C --shard K/N --report SELECTED.json
/usr/bin/time -p bun run check:change --commit C --shard K/N --report CACHED.json
```

In the selected run `--package` is not set: otherwise the comparison would hide the reached tests of consumer packages. `P` bounds only the affected package's full base. Each selected run's part count is picked by plan and the set limits; empty parts never launch. The results-and-reports cache directory is not yet cleaned automatically; the index's one-current-probe-per-path bound is no bound on historical files on disk.

Full isolated cache-bypass control: `bun run check:change --full --package P --no-cache --isolated --shard K/N`. Until the quiet window the sample's numbers stay unverified.
