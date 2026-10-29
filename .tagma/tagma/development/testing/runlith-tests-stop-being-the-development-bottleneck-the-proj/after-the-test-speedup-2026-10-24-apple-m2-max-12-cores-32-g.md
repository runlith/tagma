---
id: 01a16c5d-ff92-708b-9d5d-fed108f81bea
title: "After the test speedup, 2026-10-24: Apple M2 Max, 12 cores, 32 GB, quiet window"
ord: 21
---
Goal not reached: in this sample the whole counted suite costs 3830.6 s run CPU and 2551.1 s run-wall sum — cheaper than baseline by only 1.36× and 1.09× respectively, not 10–20×. Merging the commands' run intervals took 1287.8 s; 30–60 s is far off. No full green run obtained: 55 files red, 19 of them in neither provided list. That never proves each new-to-the-lists failure was brought by the speedup.

## Conditions and method

Compared against the [[3c13cbc1|baseline]]: one and the same Apple M2 Max, 12 cores, 32 GB, macOS 26.0.1, Bun 1.4.3, Node 26.8.1. The baseline ran under other agents' tests, this measurement without them. So the difference includes the load difference and never isolates each change's effect. Part 1 taken at 0bef03b6df376fcc0ce6b17fc7d0a937a3aed2dfa; HEAD never moved during it. Part 2 after verification and review recorded only the prepared navigation-ts fix: 0af59818cf9602026f6eff6df6e787f02c902810.

The same suites and package-script list from baseline/suites.tsv taken. Server itest and stest kept as separate passes of 12 shards by file count, three shards at a time; in each, the working scripts set --parallel=2 --no-isolate. That keeps a separate row of the baseline for each layer. App runs unit* and system, packages one suite at a time. Cargo/Swift/native builds never added: execution-host and visual-identity-node skipped the same preparatory builds as before the change.

Bun used --randomize --seed=1, Vitest --sequence.shuffle --sequence.seed=1 via the testbed's --randomize translation. The baseline used different seeds. Commands and time boundaries recorded in runs.jsonl; articles, children, worker sequences, worlds, and outcomes in raw jsonl.

Two measurement-setup errors found and excluded. Today's testbed itself serves .bun-test-timings.json, and the first itest pass split by time (7–172 files per shard), not by count: it stays separate as server-itest-time-balanced.jsonl and never entered the total. The official resource passes received an empty file-count-timings.json through --timings, which returned 51–52 itest and 21–22 stest per shard. That is an extra warmup pass, not a cold sample. At chat-ui the script is two commands: the first run never gave the seed to the main suite, while the trailing vitest refused --randomize. It is excluded; the seed=1 repeat on both commands passed. No code ever changed for measurement's sake.

## Load

read_machine_load before tests: 8.9% of the machine busy, Tagma 3.4% of it; 14.2 GB free, pressure normal. In the itest slice 76.6% busy, our test command 60.8%; in the stest slice 53.6% busy, our command 40.2%; in package integration 28.7% busy, our command 16.5%. No other testing agents. In other programs the slices showed nothing above a few percent; Tagma Dev reached 2.8%, the rest mostly OS, Tailscale, and background apps. After all runs: 8.3% busy, 15.3 GB free, pressure normal.

Uptime recorded at command boundaries and every 10 s. Minute load average in the official server-resource intervals: n=237; min 4.7, p50 12.2, p90 16.4, max 24.5. Frequent boundary readings weigh heavier in this distribution; this is no uniform time sample. Raw readings — load.jsonl.

## Total

| metric | before | after | before ÷ after |
|---|---|---:|---:|---:|
| files in ledger | 2177 | 2182 | — |
| tests in ledger | 13618 | 13629 | — |
| run wall sum, s | 2784.9 | 2551.1 | 1.09× |
| run CPU, s | 5220.6 | 3830.6 | 1.36× |
| file-row CPU, s | 5018.9 | 4085.2 | 1.23× |
| elapsed without inter-command gaps, s | ≈1310.6 (estimate) | 1287.8 (merged measured intervals) | ≈1.02× |

Part 1's actual window from the first official start to the last end: 2026-10-24T04:48:33.514Z — 2026-10-24T05:16:38.738Z, 1685.2 s. It includes reads, gaps, and method repeats. Merged intervals of only the counted commands — 1287.8 s. These are measured values, while ≈1310.6 s for the baseline is only a sum estimate with server-shard wall divided by three. The packages-unit span 330.5 s has the integration and the chat-ui repeat that ran between its commands inside it, so real spans of different suites never add up.

## By suite

The ratio is "before ÷ after": below 1 means costlier. Wall is the same run-row wall sum as in the baseline; real elapsed — from a suite's first command to its last end.

| suite | files | tests | wall before / after, s | before ÷ after | CPU before / after, s | before ÷ after | real elapsed after, s |
|---|---|---:|---:|---:|---:|---:|---:|
| server-unit | 319 | 1500 | 14.3 / 2.4 | 6.07× | 36.4 / 6.2 | 5.91× | 2.4 |
| server-itest | 622 | 3331 | 818.1 / 655.9 | 1.25× | 1649.6 / 1064.1 | 1.55× | 231.3 |
| server-stest | 256 | 1210 | 1393.3 / 1422.5 | 0.98× | 2827.8 / 2184.6 | 1.29× | 576.8 |
| app-unit | 229 | 1444 | 42.1 / 44.1 | 0.95× | 97.6 / 106.3 | 0.92× | 44.5 |
| app-system | 5 | 12 | 22.9 / 15.6 | 1.47× | 53.0 / 34.0 | 1.56× | 15.6 |
| packages-unit | 508 | 4525 | 92.4 / 56.4 | 1.64× | 194.9 / 113.5 | 1.72× | 330.5 |
| packages-integration | 214 | 1394 | 202.2 / 170.6 | 1.19× | 203.1 / 183.8 | 1.11× | 172.7 |
| packages-system | 29 | 213 | 199.6 / 183.7 | 1.09× | 158.1 / 138.1 | 1.14× | 183.9 |

## Articles and CPU distribution

| suite | load / world / tenant / body / guard, s CPU | file-row CPU, s | file CPU p50 / p90 / max, ms |
|---|---:|---:|---:|
| server-unit | 2.4 / 1.4 / 0.0 / 2.0 / 0.3 | 6.2 | 3 / 30 / 899 |
| server-itest | 56.1 / 214.9 / 68.2 / 787.5 / 5.7 | 1132.4 | 1100 / 4469 / 12168 |
| server-stest | 270.2 / 713.6 / 12.8 / 1492.8 / 6.9 | 2496.3 | 8242 / 20093 / 34825 |
| app-unit | 45.1 / 0.4 / 0.0 / 19.7 / 1.4 | 66.6 | 200 / 656 / 3377 |
| app-system | 1.3 / 20.4 / 0.0 / 1.6 / 7.1 | 30.4 | 7432 / 8456 / 8456 |
| packages-unit | 27.5 / 0.5 / 0.0 / 28.4 / 4.3 | 60.7 | 68 / 304 / 4606 |
| packages-integration | 17.4 / 11.6 / 0.0 / 144.9 / 3.4 | 177.3 | 427 / 2108 / 6102 |
| packages-system | 3.1 / 64.0 / 0.0 / 47.5 / 0.6 | 115.2 | 2423 / 10034 / 19027 |

Articles add up to file-row CPU, not run CPU. At server stest in particular, file rows give 2496.3 s while the run row gives 2184.6 s; after the change the accounting boundaries diverge substantially. This work never established the cause and never fixed the reporter. So the run-CPU gain is never claimed as the exact gain of the whole process tree. Unaccounted startup/transform shows at Vitest, for instance. Never add children into CPU separately: they are already inside the articles.

| suite | sqlite, processes / s CPU | git, processes / s CPU | other, processes / s CPU |
|---|---:|---:|---:|
| server-unit | 0 / 0.0 | 0 / 0.0 | 0 / 0.0 |
| server-itest | 2917 / 144.8 | 24734 / 304.9 (1 without CPU) | 763 / 86.1 |
| server-stest | 2634 / 207.7 | 53709 / 633.8 | 1048 / 436.9 (11 without CPU) |
| app-unit | 0 / 0.0 | 0 / 0.0 | 0 / 0.0 |
| app-system | 0 / 0.0 | 0 / 0.0 | 4 / 28.1 |
| packages-unit | 0 / 0.0 | 0 / 0.0 | 0 / 0.0 |
| packages-integration | 443 / 12.5 | 1578 / 15.2 (1 without CPU) | 743 / 38.0 (1 without CPU) |
| packages-system | 90 / 2.8 | 0 / 0.0 | 231 / 73.3 (1 without CPU) |

The report recorded shared worlds: server-unit: 2 builds, 1 of 3 files took a ready world; server-itest: 47 builds, 171 of 218 files took a ready world; server-stest: 65 builds, 43 of 108 files took a ready world. Own lists with causes remain in the run/world rows and logs under the [[82279b2b|world registry]] contract.

## Five costliest files per suite

**server-unit:**
- `apps/tagma/server/src/composition/handles.test.ts` — 0.899 s CPU.
- `apps/tagma/server/src/composition/places.test.ts` — 0.686 s CPU.
- `apps/tagma/server/src/composition/testing/cli/argv.test.ts` — 0.495 s CPU.
- `apps/tagma/server/src/composition/testing/graph/vocabulary/behaviours.test.ts` — 0.258 s CPU.
- `apps/tagma/server/src/composition/cli/verbs.test.ts` — 0.256 s CPU.

**server-itest:**
- `apps/tagma/server/src/enforcement/baseMerge.itest.ts` — 12.168 s CPU.
- `apps/tagma/server/src/composition/testing/graph/farEdges.itest.ts` — 8.366 s CPU.
- `apps/tagma/server/src/composition/testing/threads/terminalCore.itest.ts` — 7.953 s CPU.
- `apps/tagma/server/src/composition/testing/enforcement/publication.itest.ts` — 7.597 s CPU.
- `apps/tagma/server/src/platform/store/baseline.itest.ts` — 7.583 s CPU.

**server-stest:**
- `apps/tagma/server/src/composition/testing/threads/parityRequests.stest.ts` — 34.825 s CPU.
- `apps/tagma/server/src/composition/testing/threads/parityRestarts.stest.ts` — 34.046 s CPU.
- `apps/tagma/server/src/composition/testing/executions/programRoad.stest.ts` — 32.134 s CPU.
- `apps/tagma/server/src/composition/testing/threads/parityFinished.stest.ts` — 32.056 s CPU.
- `apps/tagma/server/src/managed-browser/engine.stest.ts` — 30.779 s CPU.

**app-unit:**
- `apps/tagma/app/src/lib/features/executions/terminal/Pane.svelte.test.ts` — 3.377 s CPU.
- `apps/tagma/app/src/lib/features/threads/Column.svelte.test.ts` — 2.112 s CPU.
- `apps/tagma/app/src/lib/features/checkout/CheckoutPage.svelte.test.ts` — 1.614 s CPU.
- `apps/tagma/app/src/lib/features/checkout/DiffStage.svelte.test.ts` — 1.079 s CPU.
- `apps/tagma/app/src/lib/features/executions/terminal/Views.svelte.test.ts` — 0.918 s CPU.

**app-system:**
- `apps/tagma/app/src/lib/features/checkout/files/editing.stest.ts` — 8.456 s CPU.
- `apps/tagma/app/src/lib/features/executions/terminal/inputComposition.stest.ts` — 7.638 s CPU.
- `apps/tagma/app/src/lib/features/executions/terminal/streamComposition.stest.ts` — 7.432 s CPU.
- `apps/tagma/app/src/lib/features/executions/terminal/paneComposition.stest.ts` — 6.839 s CPU.
- `apps/tagma/app/src/lib/features/checkout/files/lineDiff.worker.stest.ts` — 0.035 s CPU.

**packages-unit:**
- `packages/chat-ui/src/FeedRegions.svelte.test.ts` — 4.606 s CPU.
- `packages/agent/src/thread/conformance/transportConformance.test.ts` — 0.703 s CPU.
- `packages/agent/src/thread/conformance/rewind.test.ts` — 0.647 s CPU.
- `packages/agent/src/thread/conformance/runLog/processes.test.ts` — 0.577 s CPU.
- `packages/audio-file/src/file/writer.test.ts` — 0.571 s CPU.

**packages-integration:**
- `packages/watch/src/burst.itest.ts` — 6.102 s CPU.
- `packages/performance/src/PerformanceReports.itest.ts` — 5.884 s CPU.
- `packages/performance/src/storeRecovery.itest.ts` — 5.437 s CPU.
- `packages/performance/src/PerformanceStore.itest.ts` — 5.330 s CPU.
- `packages/sqlite-process/src/SqliteProcess.itest.ts` — 5.090 s CPU.

**packages-system:**
- `apps/tagma/demo/tools/walk.stest.ts` — 19.027 s CPU.
- `packages/execution-host/src/composition/testing/restart.stest.ts` — 12.646 s CPU.
- `packages/tagma/kit/distribution.stest.ts` — 10.034 s CPU.
- `packages/execution-host/src/composition/testing/logicFailure.stest.ts` — 9.980 s CPU.
- `packages/execution-host/src/composition/testing/programsSwap.stest.ts` — 9.390 s CPU.
## Failures

"Base list" means the exact path in failing-files.md; "world list" a path from the [[7463242b|world-run list]] absent from the baseline. Classification by file, never proof that every failed test inside it is identical. For new ones: the first failure and error; guard failures may carry passing bodies.

**server-unit:** no files with failed tests or guard.

**server-itest: 8 files.**
- `apps/tagma/server/src/enforcement/workers/inspecting.itest.ts` — new to both lists. First failure: "a change is judged new only where its own selected file newly loads what is refused". expect(...).toEqual(...): expected the chain app/src/core/model.ts → packages/client/src/models.ts → packages/client/src/shape.ts → heavy with fingerprint core/view.ts -> heavy, received [].
- `apps/tagma/server/src/composition/testing/native-harness/runLog.continues.itest.ts` — new to both lists. First failure: "SQLite continuation > Tagma bun:sqlite: the run over the log — orderly departures and Continue > two Continues over a stopped run with words waiting open one run, and the one whose words the other recorded is refused by name". error: Error: expect(received).toHaveLength(expected) · Expected length: 1 · Received length: 0
- `apps/tagma/server/src/composition/testing/enforcement/workers/modules.itest.ts` — new to both lists. First failure: "the persisted importer index judges deletions locally and recovers when a later ask returns to an older base". error: Error: expect(received).toBe(expected) · Expected: false · Received: true
- `apps/tagma/server/src/external-harnesses/testing/hookContext.itest.ts` — new to both lists. First failure: "post-tool context > a read delivers the source guidance in the reporting harness's protocol". error: Error: expect(received).toEqual(expected) · +     "hookSpecificOutput": { · +       "additionalContext": "Rule gate: values change only through the release table", · +       "hookEventName": "PostToolUse", · +     }, · +   },
- `apps/tagma/server/src/composition/testing/http/accountsDoor.itest.ts` — world list.
- `apps/tagma/server/src/composition/testing/native-harness/accountSelection.itest.ts` — world list.
- `apps/tagma/server/src/composition/testing/http/concurrentGraph.itest.ts` — new to both lists. First failure: "concurrent graph > acts and scans of one tree all land when they arrive together". error: EffectDrizzleQueryError: Failed query: select "value" from "meta" where "meta"."key" = ?
- `apps/tagma/server/src/executions/host/boot.itest.ts` — new to both lists. First failure: "(unnamed)". error: 2 process(es) outlived the tests that started them and were killed:

**server-stest: 40 files.**
- `apps/tagma/server/src/composition/testing/http/settingsPlace.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/executions/hostBoot.stest.ts` — new to both lists. First failure: "execution host boot and custody > installation > a second server accepts the same host but declines custody held by the first". error: Error: expect(received).toBe(expected) · Expected: "Adopted" · Received: "Raised"
- `apps/tagma/server/src/composition/testing/landing/submitGit.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/cli/worktree.stest.ts` — base list.
- `apps/tagma/server/src/release-channel/runner.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/native-harness/startCost.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/executions/hostChange.stest.ts` — new to both lists. First failure: "a restart that changes the execution host > host > a take-over that fails after the door names its cause in the host standing and answers the calls that waited for it". error: Error: this case needs the host the change left serving
- `apps/tagma/server/src/composition/testing/cli/ensureServer.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/plugins/agents.stest.ts` — base list.
- `apps/tagma/server/src/cli/project.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/http/threadTypeDoor.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/enforcement/copiedLaw.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/threads/paritySessions.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/place.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/http/mergeTakesBase.stest.ts` — new to both lists. First failure: "merge takes base > a merge whose base changed the graph takes the base into the branch first and is judged by the merged graph". error: Error: expect(received).toEqual(expected) · -   "91fd24f82db29fc214946fdcc08ed457b5bb03f6", · +   "d7ffded6111ad04bdd7c87abcd5a01253c28bce1", · - Expected  - 1 · + Received  + 1
- `apps/tagma/server/src/composition/testing/http/threadProjectDoor.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/threads/terminalDelivery.stest.ts` — world list.
- `apps/tagma/server/src/composition/testing/threads/parityStops.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/threads/attention.stest.ts` — base list.
- `apps/tagma/server/src/managed-browser/installed.stest.ts` — new to both lists. First failure: "the engine on the installed Google Chrome > in an out-of-process frame a ref clicks through, and a top-document banner over it refuses element-obscured". error: Error: no line matching /button "Hidden"/ holds a ref in: · - Iframe [ref=e1] · - text "Consent banner"
- `apps/tagma/server/src/composition/testing/subjectPlace.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/restart.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/cli/hookPlace.stest.ts` — world list.
- `apps/tagma/server/src/composition/testing/http/threadsDoor.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/enforcement/measurementWrites.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/threads/modelChanges.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/threads/protocolClaude.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/threads/terminalPlain.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/http/projectsDoor.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/change-record/stepDebt.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/threads/rolloutDrill.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/native-harness/evidence.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/threads/conversations.stest.ts` — new to both lists. First failure: "conversation index and journal > word forms, Unicode and scope find only spoken messages and reader steering, never private or keep-warm text". error: Error: expect(received).toEqual(expected) · -   "complete": true, · -   "unindexed": 0, · +   "complete": false, · +   "unindexed": 1, · - Expected  - 2
- `apps/tagma/server/src/composition/testing/http/reflectWorktree.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/threads/protocolRuns.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/native-harness/directoryWarmth.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/http/approver.stest.ts` — base list.
- `apps/tagma/server/src/native-harness/modelDefaults.stest.ts` — base list.
- `apps/tagma/server/src/composition/testing/executions/serverHost.stest.ts` — new to both lists. First failure: "public host succession > (unnamed)". error: FixtureRequestFailed: Fixture health returned HTTP 503
- `apps/tagma/server/src/composition/testing/executions/serverHostRecovery.stest.ts` — new to both lists. First failure: "public host recovery > (unnamed)". error: FixtureRequestFailed: Fixture health returned HTTP 503

**app-unit: 1 file.**
- `apps/tagma/app/src/lib/features/executions/terminal/Pane.svelte.test.ts` — new to both lists. First failure: "the first keystroke after a restart the person waited through is not the interrupted tail". Error: never reached: the fresh execution

**app-system: 4 files.**
- `apps/tagma/app/src/lib/features/executions/terminal/paneComposition.stest.ts` — new to both lists. First failure: "process residue". residue 1; afterAll: process(es) outlived the tests that started them and were killed. Test bodies passed; a guard failed, no failed body of its own.
- `apps/tagma/app/src/lib/features/executions/terminal/streamComposition.stest.ts` — new to both lists. First failure: "process residue". residue 1; afterAll: process(es) outlived the tests that started them and were killed. Test bodies passed; a guard failed, no failed body of its own.
- `apps/tagma/app/src/lib/features/executions/terminal/inputComposition.stest.ts` — new to both lists. First failure: "process residue". residue 3; afterAll: process(es) outlived the tests that started them and were killed. Test bodies passed; a guard failed, no failed body of its own.
- `apps/tagma/app/src/lib/features/checkout/files/editing.stest.ts` — new to both lists. First failure: "process residue". residue 1; afterAll: process(es) outlived the tests that started them and were killed. Test bodies passed; a guard failed, no failed body of its own.

**packages-unit:** no files with failed tests or guard.

**packages-integration: 2 files.**
- `packages/execution-host/src/hostConformance.itest.ts` — new to both lists. First failure: "stock host: execution host conformance > the host answers the installation the recorded profile names". error: Error: expect(received).toBe(expected) · Expected: 0 · Received: 4
- `packages/performance/src/MemoryCaptures.itest.ts` — base list.

**packages-system:** no files with failed tests or guard.

Apart from the files, cloud integration never reached the tests: "Docker is not running or not installed: the cloud needs its Postgres container". The same precondition was absent in the baseline. Other package scripts finished; No tests found messages left no red commands. Zero file rows at uninstrumented suites mean no zero tests: the baseline already excluded 34 suites without preload from the distribution. This measurement adds no preload to them. Their process-level cost sits in logs and run rows, but files, tests, and articles go uncounted.
## Deferred checks

1. blocksDoorFields.itest.ts, --parallel=1 --no-isolate --randomize: seeds 1/2/3 — all green, 5 tests each; elapsed 3.97 / 3.45 / 3.78 s.
2. navigation-ts/src/launcher.itest.ts: randomized package seed=1 — 11/11; standalone `bun test ./src/launcher.itest.ts --parallel=1` — 11/11, elapsed 3.71 s. The independent [[01a16c4d-2553-7f09-a6d2-9e6461178a99|reviewer]] found no defects, started nothing, changed nothing. The provided fix landed authored by its holder in 0af59818cf; commit steps formatted one file. That commit carried no other file.
3. composition/handles.test.ts separately — 1/1, elapsed 0.86 s.
4. bun scripts/bench-project-birth.ts called once, all three add_project answered 200. Wall: 580.4 / 466.0 / 459.3 ms; own-process CPU: 330.6 / 260.6 / 238.6 ms. Each sample: 31 git, 327 measured SQL; git wall 302.8 / 302.2 / 300.8 ms, SQL exec 26.9 / 26.3 / 25.0 ms. SQL excludes mirror initialization/disposal; CPU excludes children. After the samples the script never exited and kept host inventory WireUnavailable: stopped on the lead's instruction through stop_command (explicit-stop, signal; cleanup complete, survived 0, unverified 0). That is a script-exit defect, not project-birth time. Log: ~/.tagma-dev/scratch/01a16c3b-ce73-7189-8807-2985427c56c6/after/part2-birth.log.
5. check:change, /usr/bin/time -p:

| run | real, s | user, s | sys, s | outcome |
|---|---|---:|---:|---|
| part2-check-full | 4.88 | 2.11 | 3.32 | exit 1, EISDIR |
| part2-check-commit-1 | 3.87 | 3.18 | 6.19 | exit 1, EISDIR |
| part2-check-commit-2 | 2.34 | 1.27 | 6.34 | exit 1, EISDIR |

All three fell before test/cache checks in scripts/change/inputs.ts:100 on readFileSync of a catalog (EISDIR). The second repeat is no proven cache hit; change-verification speedup is never proven by this sample. Full commands exactly as the brief: --full --package apps/tagma/server --no-cache --shard 1/12; then two --commit 9f0891dd7a --shard 1/12.

## Materials and result boundary

Raw data, logs, and summary.json: ~/.tagma-dev/scratch/01a16c3b-ce73-7189-8807-2985427c56c6/after/. Driver ~/.tagma-dev/scratch/01a16c3b-ce73-7189-8807-2985427c56c6/measure.ts, aggregation ~/.tagma-dev/scratch/01a16c3b-ce73-7189-8807-2985427c56c6/summarize.ts, this note's generator ~/.tagma-dev/scratch/01a16c3b-ce73-7189-8807-2985427c56c6/report.ts. Eligible reports filtered by finished run roots; each re-verified with the original baseline/aggregate.ts, its output saved as *.summary. In read_changes after the work this session holds 0 paths. Unrelated edits to .agents/skills/tagma/OPERATIONS.md and .opencode/plugins/tagma/package.json never changed and never committed. The live Tagma server never stopped, restarted, or replaced.
