---
id: 01a16c9f-17f1-74c9-8c5f-a5343e4db078
title: "Stest file outcomes: file, outcome, reason, CPU before, world or covering test"
ord: 1
---
Outcome of each `*.stest.ts` per [[1c6e2051]]. CPU before is the file's line in measurement [[08f81bea]] (seconds, own process and children); "—" means the file was not in the measurement. For kept files the taken world (kind and parameters) or the reason for its own; for deleted ones the test covering their contract.

Total: itest — 283, deleted — 11; no outcome — 0.

In four kept files logic moved to unit: `enforcement/contract/wire/checks.test.ts`, `mcp/McpPool.test.ts`, `mcp/mcpToolCatalog.test.ts`, `execution-host/ExecutionStop.test.ts`. In nine, part of the tests deleted.

## Handoff state, 2026-10-24

`test:system` scripts and the system CI job removed in f18c2a9420. `--randomize` not returned to `test` and `test:integration` scripts. A run of all sets on seeds 1–3 (on f18c2a9420…868801b2be) gave 24 red files; most fixed pointwise, no full rerun after the fixes.

Red and unconfirmed at handoff to module owners:
- **`execution-host`: `composition/testing/liveTempo.itest.ts` and `tempo.itest.ts`.** The Darwin background policy at the nested process is removed by the working Tagma server's external execution host with old `Pacing`. Fix 966de8fa85 ([[a59cc76a]]) reaches it only by an operator server restart. No external host in CI.
- **`threads/protocolResource.itest.ts`.** A product race: clean removal of a stale runner in `ProtocolEndings.finish` fails a late promised start. Fix checked on seeds 1–3 but not landed: its group hits the gate of rule [[ea465bed]] on `external-harnesses/protocol/activities.ts:71`. Edits lie uncommitted in the working tree.
- **`native-harness/activityWindow.itest.ts`.** Terminal runs write no RUN activity ([[86c58c46]]). The projection is written but not landed: three confirmed P2 reviews unfixed. Edits in `external-harnesses/terminal/*` uncommitted.
- **`threads/operatorMessage.itest.ts`.** The deletion deadlock fixed in 9b33a8424e. One mixed seed-3 run gave an afterEach timeout; cause unestablished.

## Z1 parity

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/threads/parityRequests.stest.ts` | itest | parity of requests; 4 server-restart tests moved to parityRestarts | 34.8 | door {hostSourcePath: execution-host} + lend models | 8baa533bf9 |
| `…/testing/threads/parityRestarts.stest.ts` | itest | subject is server restart; took 6 restart tests from Requests and Stops | 34.0 | own: restarts the world server | d3801c3cda |
| `…/testing/threads/parityFinished.stest.ts` | itest | parity of a finished turn through real ACP processes | 32.1 | door {hostSourcePath: execution-host} + lend models | 8baa533bf9 |
| `…/testing/threads/parity.stest.ts` | itest | parity of words and stops on all transports through the real door | 24.1 | door {hostSourcePath: execution-host} + lend models | 8baa533bf9 |
| `…/testing/threads/parityStops.stest.ts` | itest | parity of stops; 2 restart tests moved to parityRestarts | 23.9 | door {hostSourcePath: execution-host} + lend models | 8baa533bf9 |
| `…/testing/threads/terminalPlain.stest.ts` | itest | plain CLI on a real PTY; cross-test state leak fixed | 17.4 | door {hostSourcePath: execution-host} + lend models | d3801c3cda |
| `…/testing/threads/paritySessions.stest.ts` | itest | session copy, keep-warm and switch on native and ACP; the red test fixed in the product (moves.ts) | 16.7 | own: opens the world's maintenance, which no file closes | d3801c3cda |
| `…/testing/threads/terminalConformance.stest.ts` | itest | conformance of the terminal transport on a real PTY | 15.3 | door {hostSourcePath: execution-host} + lend models | d3801c3cda |
| `…/testing/threads/terminalDelivery.stest.ts` | itest | word delivery to a real PTY; renamed to terminalPtyDelivery.itest.ts since terminalDelivery.itest.ts already exists | 11.5 | door {hostSourcePath: execution-host} + lend models | d3801c3cda |
| `…/testing/threads/terminalInterrupt.stest.ts` | itest | terminal-turn interrupt on a real PTY | 6.7 | door {hostSourcePath: execution-host} + lend models | d3801c3cda |

## Z2 protocol

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/threads/protocolRoad.stest.ts` | itest | Real ACP wire, permission, receipt and recovery through driver and SQLite | 26.5 | HostBundle null + SharedPool null; isolated file store/host | 0c0a4ec8b5 |
| `…/testing/threads/claudeConformance.stest.ts` | itest | Transport conformance on the real Claude runner with scripted SDK | 26.3 | HostBundle null + SharedPool null; isolated file store/host | bd298b58c9 |
| `…/testing/threads/protocolMethods.stest.ts` | itest | Protocol extensions checked on the real ACP boundary | 20.4 | HostBundle null + SharedPool null; isolated file store/host | bd298b58c9 |
| `…/testing/threads/protocolSummarizer.stest.ts` | deleted | A live model was needed to start and continue a Claude session; the summarizer contract is repeatably covered | 20.4 | packages/agent/src/thread/conformance/compactionSummarizers.test.ts › a foreign-only session delays a step request until the turn ends, resets before folding, and launches from the summary | 5524780b64 |
| `…/testing/threads/protocolResource.stest.ts` | itest | Real ACP process hold, lease, restart and release | 17.8 | HostBundle null + SharedPool null; isolated file store/host | b2a6ed3440 |
| `…/testing/threads/protocolRuns.stest.ts` | itest | Run ledger and real shutdown; the destroyed runtime isolated from neighbor tests | 15.9 | door {hostSourcePath: EXECUTION_HOST_ROOT}; scoped models; own only for shutdown case | 51bdb3cb33 |
| `…/testing/threads/protocolTransport.stest.ts` | itest | Real transport switch, subscriptions and images through the product door | 13.8 | door {hostSourcePath: EXECUTION_HOST_ROOT}; scoped models | 51bdb3cb33 |
| `…/testing/threads/protocolRaces.stest.ts` | itest | Delivery, cancel, adoption and compaction races on the real wire; sleep replaced with a fact | 13.5 | HostBundle null + SharedPool null; isolated file store/host | 40b6919b4a |
| `…/testing/threads/protocolConformance.stest.ts` | itest | One core conformance set on the real ACP transport with a scripted agent | 13.0 | HostBundle null + SharedPool null; isolated file store/host | bd298b58c9 |
| `…/testing/threads/protocolStops.stest.ts` | itest | Stop and handover on the real process; lease moves TestClock | 12.5 | HostBundle null + SharedPool null; isolated file store/host | b2a6ed3440 |
| `…/testing/threads/protocolCut.stest.ts` | itest | Rewind and fork keep the needed prefix of a real ACP session | 12.2 | HostBundle null + SharedPool null; isolated file store/host | b2a6ed3440 |
| `…/testing/threads/protocolHandover.stest.ts` | itest | Rewritten with no live model: native tool history accepted as a vendor transcript, Claude reply returns to native through real doors | 12.0 | door {hostSourcePath: EXECUTION_HOST_ROOT}; scoped models; apps/tagma/server/src/composition/testing/threads/protocolHandover.itest.ts › native tool history is accepted as a vendor transcript, and the Claude answer reaches the next native request in one feed | 7bc8146e0e |
| `…/testing/threads/protocolWords.stest.ts` | itest | Reader words, steering, follow-up and report pass a real hosted-thread door | 11.5 | door {hostSourcePath: EXECUTION_HOST_ROOT} | 4d99a8394f |
| `…/testing/threads/protocolStep.stest.ts` | deleted | ls count and PELICAN depended on live-model obedience; step transition covered scripted | 10.6 | apps/tagma/server/src/composition/testing/threads/protocolMethods.itest.ts › a compaction asked at the step lands inside the running turn, which goes on, and one the turn gives no step to runs after it | 5524780b64 |
| `…/testing/threads/protocolCancels.stest.ts` | itest | Cancel outruns unrecorded frames and finishes with a real receipt | 10.5 | HostBundle null + SharedPool null; isolated file store/host | b2a6ed3440 |
| `…/testing/threads/protocolFork.stest.ts` | deleted | Exact PELICAN/CRANE depended on a live model; fork-point choice covered at the runner | 10.2 | apps/tagma/server/src/external-harnesses/runner/claude-code/contract.test.ts › finds the prompt by its uuid and resumes a fork at the entry before it | 5524780b64 |
| `…/testing/threads/protocolOrder.stest.ts` | itest | A durable assistant message precedes the tool result; a call projection awaited instead of sleep | 9.7 | HostBundle null + SharedPool null; isolated file store/host | 40b6919b4a |
| `…/testing/threads/protocolLaunches.stest.ts` | itest | A valid launch follows the core run fate, including attachments and stop before prompt | 8.7 | HostBundle null + SharedPool null; isolated file store/host | c6267c955f |
| `…/testing/threads/hostedReveals.stest.ts` | itest | An exposed deferred tool survives compaction through a real MCP door | 7.8 | door {hostSourcePath: EXECUTION_HOST_ROOT} | 4d99a8394f |
| `…/testing/threads/protocolConfigure.stest.ts` | itest | Model, effort and switches genuinely apply to an ACP session at start and continuation | 7.0 | HostBundle null + SharedPool null; isolated file store/host | c6267c955f |
| `…/testing/threads/protocolActs.stest.ts` | itest | Stop, archive and continue pass the real hosted-thread core door | 6.6 | door {hostSourcePath: EXECUTION_HOST_ROOT} | 4d99a8394f |
| `…/testing/threads/protocolIdle.stest.ts` | itest | A real idle process finishes and continues the vendor session on next words | 6.3 | HostBundle null + SharedPool null; isolated file store/host | 40b6919b4a |
| `…/testing/threads/protocolCursor.stest.ts` | itest | The birth-chosen account reaches the runner; the persisted catalog isolated under the lead's allowed exception | 5.7 | own: this scenario refreshes and persists the Cursor model catalog | 35a82746a7 |
| `…/testing/threads/protocolHosted.stest.ts` | itest | A real hosted-thread start carries the chosen directory account and held execution | 5.6 | HostBundle null + SharedPool null; isolated file store/host | c6267c955f |
| `…/testing/threads/protocolThreshold.stest.ts` | deleted | Threshold depended on a live request/cache usage; automatic transition covered scripted | 5.1 | apps/tagma/server/src/composition/testing/threads/protocolMethods.itest.ts › a turn measured past the threshold that ends before its next step is compacted after it, by its own run | 5524780b64 |
| `…/testing/threads/protocolClaude.stest.ts` | deleted | Needed concrete tool calls and a live-model answer; protocol parts covered separately | 3.8 | apps/tagma/server/src/external-harnesses/runner/claude-code/contract.test.ts › answers the sizes, the summary and the spend, and tells the client what was compacted | 5524780b64 |

## Z3 exec

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/executions/programRoad.stest.ts` | itest | Real ProgramRoad.run: stdin, owner, cwd, exit, operands and process-tree stop | 32.1 | HostBundle null + CheckoutSeed null + SharedPool null; one scoped real host | 18562d5990 |
| `…/testing/executions/sandboxWorld.stest.ts` | itest | Real guest isolation and stop/resume through a native agent; unavailable Docker no longer builds hooks | 17.8 | own: lifecycle guest worlds; SharedPool null; Docker runtime not checked | 5e590e7785 |
| `…/testing/executions/laneCustody.stest.ts` | itest | Real terminal lanes, input, custody and binding release through the tool/socket boundary | 16.7 | HostBundle null + CheckoutSeed null + SharedPool null; scoped host cases | ac05a6d100 |
| `…/testing/executions/hostChange.stest.ts` | itest | Real host logic and bundle change keeps processes, records, stdin and the migration ledger | 16.2 | own: host succession and runtime closing; HostBundle null + SharedPool null | ac05a6d100 |
| `…/testing/sandbox/dockerWorld.stest.ts` | itest | Real typed-file/shell, isolation, network and guest restart | 14.1 | SandboxResources {source:empty}; scoped Docker tenant | e2220247a6 |
| `…/testing/executions/serverHost.stest.ts` | itest | Public restart_server keeps holder, children, generation and cursor of the real server | 13.7 | own: restart of its own server launch and mutable host source | ac05a6d100 |
| `…/testing/executions/hostBoot.stest.ts` | itest | Real source/closure boots, second-server custody and freeing the first connection | 13.6 | own: independent boots and runtime shutdown; HostBundle null + SharedPool null | ac05a6d100 |
| `…/testing/executions/managedWorld.stest.ts` | itest | Real managed bash, run-keyed grants and cancel before and after admission | 11.6 | HostBundle null + CheckoutSeed null + SharedPool null; one main host and an isolated foreign-custody case | 5e590e7785 |
| `…/testing/sandbox/importOutput.stest.ts` | itest | Real import_output, attribution and landing; six dependent phases merged with no assertion loss | 8.5 | SandboxResources {source:import}; seed copy and scoped Docker tenant | e2220247a6 |
| `…/testing/executions/recoveryRoad.stest.ts` | itest | A real standalone execution-host CLI reads, stops and closes the host beside the serving floor | 8.3 | HostBundle null + CheckoutSeed null + SharedPool null; scoped lifecycle cases | 5e590e7785 |
| `…/testing/executions/serverHostRecovery.stest.ts` | itest | Public restart, successor loss and logic gap keep children until the end of its own server launch | 8.1 | own: successor loss and finishing its own server launch | ac05a6d100 |
| `…/testing/executions/laneGrace.stest.ts` | itest | Real socket disconnect/reload frees lanes while the open page keeps typing | 8.0 | ViewFixture null over door {hostSourcePath: execution-host} | 5e590e7785 |
| `…/testing/executions/viewLanes.stest.ts` | itest | Real HTTP/socket lanes, input receipts, grid arbitration and ending streams | 5.0 | ViewFixture null over door {hostSourcePath: execution-host} | 5e590e7785 |
| `…/testing/executions/threadDeleteDisown.stest.ts` | itest | Public delete_thread removes the deleted thread's commands and keeps foreign retained output | 4.4 | door {hostSourcePath: execution-host} | 5e590e7785 |
| `…/testing/sandbox/sandboxSnapshot.stest.ts` | itest | Real snapshot of a named git commit and history/graph exclusion | 1.6 | SandboxResources {source:snapshot}; scoped sandbox tenant | e2220247a6 |
| `…/testing/sandbox/sandboxLease.stest.ts` | itest | Real resume, image-revision check and Docker boundary | 1.2 | SandboxResources {source:snapshot}; scoped sandbox tenant | e2220247a6 |
| `…/testing/sandbox/preparedTreeNetwork.stest.ts` | itest | Real bans on foreign HTTPS host, raw socket and DNS | 0.9 | SandboxResources {source:prepared}; scoped prepared-tree tenant | e2220247a6 |
| `…/testing/sandbox/sandboxRelease.stest.ts` | itest | Real export, release and reconciliation of only marked Docker resources | 0.7 | SandboxResources {source:snapshot}; scoped sandbox tenant | e2220247a6 |
| `…/testing/sandbox/preparedTreeRelease.stest.ts` | itest | Real release of an artifact keeps the already made sandbox copy | 0.5 | SandboxResources {source:prepared}; scoped prepared-tree tenant | e2220247a6 |
| `…/testing/sandbox/preparedTreeGrant.stest.ts` | itest | Real granted-HTTPS build, sealed archive and independent offline copies | 0.3 | SandboxResources {source:prepared}; scoped prepared-tree tenant | e2220247a6 |
| `server/sandbox/engine/docker/proxy.stest.ts` | itest | Real CONNECT proxy; two runs merged into one container with prior destinations | 0.2 | ProxyImage null; scoped probe container | e2220247a6 |

## Z4 browser

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `server/managed-browser/engine.stest.ts` | itest | All 16 conformance scenarios of a real managed Chromium kept; storage shared, test pages closed | 30.8 | testing/ManagedBrowser {}; file-scoped host | e604e3537f |
| `server/managed-browser/installed.stest.ts` | itest | Kept a separate installed-Chrome conformance: this build once caught the earlier frame-adoption race | 23.7 | testing/ManagedBrowser {}; file-scoped installed host | e604e3537f |
| `server/desktop-browser/engine.stest.ts` | itest | All 16 conformance scenarios of the real Electron/CDP transport kept on shared storage | 20.3 | testing/DesktopBrowser null; file-scoped Electron host | e604e3537f |
| `apps/tagma/demo/tools/walk.stest.ts` | itest | Public walk preserves the broken-terminal and unreachable-cue findings; unrelated entities removed | 19.0 | No runtime world; ready demo bundle and one isolated Chromium | 80931595ce |
| `server/managed-browser/host.stest.ts` | itest | Real UA, worker, alert, download and recovery checked through events; own worlds only for close/reopen | 13.8 | testing/ManagedBrowser {} and {missing:true}; own testing/ManagedRestart: world lifetime is the test subject | e604e3537f |
| `server/managed-browser/screencast.stest.ts` | itest | Real frames, input, clipboard, chooser, eviction and native layout; eviction awaited on budget return, no sleep/deadline | 12.8 | testing/ManagedBrowser {} and {native:true}; file-scoped hosts | e604e3537f |
| `apps/tagma/app/src/lib/features/checkout/files/editing.stest.ts` | itest | Real OpenedDocument/FileOps path HTTP/Live to a file: write, rebase, conflict, trash/move/undo | 8.5 | testing/AppPage null; file tenant-project and checkout | 2d1dce0d06 |
| `server/managed-browser/cookies.stest.ts` | itest | Real import, partial write, observed rollback to the next write and serialization; independent baseline, 201 cookies | 7.6 | testing/ManagedBrowser {}; file-scoped wrapped host | e604e3537f; fix 2857d7dc0f |
| `apps/tagma/app/src/lib/features/executions/terminal/inputComposition.stest.ts` | itest; part of tests deleted | Real input and admission-size reduced to one cat child; grants repeated the owner | 7.6 | testing/AppPage null; file tenant-project and checkout | 2d1dce0d06 |
| `apps/tagma/app/src/lib/features/executions/terminal/streamComposition.stest.ts` | itest; part of tests deleted | Kept the replay/live/parsed-ack path; stale cursor and positions-only already covered by owners | 7.4 | testing/AppPage null; file tenant-project and checkout | 2d1dce0d06 |
| `…/testing/pageComposition.stest.ts` | itest; part of tests deleted | One real shell proves HTTP-door start/lane/input/output/exit; fake restart and cursor duplicate deleted | 7.3 | door {hostSourcePath:packages/execution-host}; file tenant-project and checkout | abcb4cd98e |
| `apps/tagma/app/src/lib/features/executions/terminal/paneComposition.stest.ts` | deleted | Pane uninvolved; wire smoke and another execution's creation were passed off as Pane/restart checks | 6.8 | apps/tagma/server/src/composition/testing/pageComposition.itest.ts › the page starts a terminal through the real door, types into its lane, reads its output and observes its exit; packages/execution-host/src/ExecutionRecord.itest.ts › a cursor that names something the record cannot answer is refused, and a sealed record answers nothing live | 2d1dce0d06 |
| `server/desktop-browser/restart.stest.ts` | itest | Keeps one real Electron through reload and two servers; readiness and recovery await events | 2.9 | own testing/DesktopRestart: server close and reopen is the test subject | e604e3537f |
| `server/desktop-browser/cookies.stest.ts` | itest | Real partition cookies and page sending kept; the temp file created in file scope | 2.8 | testing/DesktopBrowser null; file-scoped Electron host | e604e3537f |
| `apps/tagma/desktop/src/browser/identity.stest.ts` | itest | Real redirect and sign-in identity need one Electron; no extra boots | 0.6 | No runtime world; one isolated Electron fixture | 80931595ce |
| `apps/tagma/app/src/lib/features/checkout/files/lineDiff.worker.stest.ts` | itest; part of tests deleted | A real Worker checks correlation of two requests; the stale answer already covered by the owner unit | 0.0 | One real Worker; terminate in finally, no runtime world needed | 2d1dce0d06 |
## Z5a threads-a

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/threads/worktreeSpawn.stest.ts` | itest | Worktree birth, setup and the first child bash pass a real runtime | 15.6 | door {hostSourcePath: EXECUTION_HOST_ROOT} | bfd4a15c3c |
| `…/testing/threads/rolloutDrill.stest.ts` | itest | Journal restore and corruption touch the whole machine; own worlds kept | 14.3 | own: restore of all journals; machine DB loss; project mirror loss | e5abc78fe3 |
| `…/testing/threads/heldTasks.stest.ts` | itest | Held-task handover checks real doors and graph copies | 10.7 | door {} | 82dede52b5 |
| `…/testing/threads/teamPlaces.stest.ts` | itest | A family across homes persists in SQLite and is visible through doors and subscriptions | 10.1 | door {} | 82dede52b5 |
| `…/testing/threads/threadMove.stest.ts` | itest | Worktree change acts between two real commands | 9.6 | door {hostSourcePath: EXECUTION_HOST_ROOT} | 82dede52b5 |
| `…/testing/threads/titleRoads.stest.ts` | itest | Title-model choice and result recording checked through the runtime | 9.3 | door {} | 82dede52b5 |
| `…/testing/threads/terminalWidget.stest.ts` | itest | The permission-widget answer passes a real PTY | 8.8 | door {hostSourcePath: EXECUTION_HOST_ROOT} | e5abc78fe3 |
| `…/testing/threads/birthPlace.stest.ts` | itest | Child birth and move between projects pass real doors | 8.5 | door {} | e5abc78fe3 |
| `…/testing/threads/externalCaller.stest.ts` | itest | External callers checked through the HTTP door and kept lines | 8.3 | door {} | e5abc78fe3 |
| `…/testing/threads/rewind.stest.ts` | itest | Rewind, restore and branch change the journal the model really reads | 7.8 | door {} | e5abc78fe3 |
| `…/testing/threads/terminalLaunch.stest.ts` | itest | A failed CLI launch finishes real session and run | 7.4 | door {} | e5abc78fe3 |
| `…/testing/threads/worktreeNaming.stest.ts` | itest | A thread title renames the real git branch | 7.3 | door {} | e5abc78fe3 |
| `…/testing/threads/listWindow.stest.ts` | itest | The list window checks SQLite, live events and held paths of real git | 6.5 | door {} | e5abc78fe3 |
| `…/testing/threads/purposeActivity.stest.ts` | itest | Recap and CLI title keep door-visible activity and usage | 6.4 | door {hostSourcePath: EXECUTION_HOST_ROOT} | e5abc78fe3 |
| `…/testing/threads/menuBirth.stest.ts` | itest | The menu births a CLI thread with no provider account through create_thread | 5.9 | door {hostSourcePath: EXECUTION_HOST_ROOT} | e5abc78fe3 |
| `…/testing/threads/pins.stest.ts` | itest | A pin passes the plugin door, feed and durable SQLite storage | 5.8 | door {} | e5abc78fe3 |
| `…/testing/threads/threadArchive.stest.ts` | itest | Archive stops real runtime resources and keeps journal and lineage | 5.7 | door {} | e5abc78fe3 |

## Z5b threads-b

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/threads/titleCli.stest.ts` | itest | A real CLI answer gives the title with no API account; PATH and directory sign-in restored | 5.3 | door {hostSourcePath: /opt/workspaces/runlith/packages/execution-host} | 3adf40fc9b |
| `…/testing/threads/naming.stest.ts` | itest | Title/recap roads, cancel and activity read through a real composition; accounts and defaults scoped | 5.1 | door {} | 3adf40fc9b |
| `…/testing/threads/forkRestore.stest.ts` | itest | Branch restore from rollout after DB loss needs runtime reopen; shared SQLite pool | 4.5 | own: DB loss and runtime reopen from rollout; testing/ForkRestoreWorld null + testing/SharedPool null | 3adf40fc9b; part of implementation cea31184ff |
| `…/testing/threads/operatorMessage.stest.ts` | itest | Accepted operator words reach the parent by settings and authority; families and accounts released | 4.4 | door {} | 3adf40fc9b |
| `…/testing/threads/attention.stest.ts` | itest | The machine door and raw pagination checked on their own projects; synthetic runs and threads scoped | 4.4 | door {} | 3adf40fc9b; review bcc8f87f51 |
| `…/testing/threads/terminalAsks.stest.ts` | itest | Permission hook, core question and operator answer hold one lifecycle | 4.3 | door {} | 8d2d365843 |
| `…/testing/threads/decisions.stest.ts` | itest | The decision road, probabilities and usage through a real composition; keys and defaults do not leak between tests | 3.9 | door {} | 8d2d365843 |
| `…/testing/threads/teamBirth.stest.ts` | itest | Instead of prompt text, the newborn's own command checked through read_team, with no turn run | 3.9 | door {} | 8d2d365843 |
| `…/testing/threads/spawnSeat.stest.ts` | itest | A real spawn_agent picks native/ACP transport; two prompt-text assertions deleted | 3.8 | door {} | 8d2d365843 |
| `…/testing/threads/shelf.stest.ts` | itest | Maintenance and in-use eviction proved with facts and one needed driver, no sleep | 3.7 | own: runtime maintenance gate opens once; door {drivers: [rollout-shelving]} | de3926b13d; review bcc8f87f51 |
| `…/testing/threads/birthAuthority.stest.ts` | itest | Birth, inheritance and authority change reach the real thread door | 3.3 | door {} | 8d2d365843 |
| `…/testing/threads/modelChanges.stest.ts` | itest | set_thread_model leaves one replaceable unread signal in a sleeping parent's inbox | 2.6 | door {} | 8d2d365843 |
| `…/testing/threads/conversations.stest.ts` | itest | FTS, journal, coverage and file restore check real SQLite/disk; isolation already fixed 1f289170d0 | 2.2 | graph, a tenant per scenario | de3926b13d |
| `…/testing/threads/restedComposition.stest.ts` | itest | Composition/compaction doors keep the unloaded journal and ledger | 2.2 | door {} | de3926b13d |
| `…/testing/threads/terminalGuidance.stest.ts` | itest | Receipt dedupes law delivery and repeat after compact; lines are law data, not product copy | 1.8 | door {} | de3926b13d |
| `…/testing/threads/hostedAccounts.stest.ts` | itest | Account switch keeps the vendor session and frees the process pin between turns | 1.2 | door {} | de3926b13d |

## Z6a http-a

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/http/collaborationDoor.stest.ts` | itest | Shared world with loan models, scoped account and threads; event waits instead of polling | 22.5 | door {} | cdaea69ff1 |
| `…/testing/http/approver.stest.ts` | itest | Project/user grants and accounts restored; the stale SQLite reader root fixed | 20.9 | door {hostSourcePath: packages/execution-host} | cdaea69ff1 |
| `…/testing/http/graphFormat.stest.ts` | itest | Fresh project of the shared world, topology event and HTTP regression of foreign broken worktree isolation | 20.1 | door {} | a1ab0f0001 |
| `…/testing/http/worktreesDoor.stest.ts` | itest | Real HTTP boundary of creation/recovery/cleanup, including nested foreign checkout | 18.1 | door {} | 5ba60ba2f9 |
| `…/testing/http/projectCatalogs.stest.ts` | itest | Catalogs at birth checked in fresh projects; user graph.catalogs restored | 17.8 | door {} | a16aa69b50 |
| `…/testing/http/graphlessDoor.stest.ts` | itest; part of tests deleted | Two projects and two worktrees suffice; the delayed Background unit-check duplicate deleted | 15.7 | door {} | e8d5617d6a |
| `…/testing/http/checkoutActsDoor.stest.ts` | itest | HTTP acts of real git, hooks and the private commit tree already take the shared world | 14.5 | door {} | e8d5617d6a |
| `…/testing/http/doorParity.stest.ts` | itest | Native/HTTP parity and the real global-home worktree are the boundary | 13.3 | own: it commits into the global project | d1f7d225de |
| `…/testing/http/projectsDoor.stest.ts` | itest | graphless read_project fixed; symlink and repair of its own moved-repo fixture | 12.6 | door {} | a1ab0f0001 |
| `…/testing/http/admission.stest.ts` | itest | Graphless admission and registry freshness; settled instead of deadline polling, one fresh enough | 11.4 | door {} | a8d1953901 |
| `…/testing/http/mergeTakesBase.stest.ts` | itest | Fresh project of the shared host world; graph sync before the checked parent tips | 10.7 | door {hostSourcePath: packages/execution-host} | bcf1425523 |
| `…/testing/http/graphRecovery.stest.ts` | itest | A real recovery door; loan models and finish scope of born threads | 10.4 | door {} | cdaea69ff1 |
| `…/testing/http/reflectWorktree.stest.ts` | itest | Source-project routing boundary; comparison with approved HEAD and graph.commit restore | 9.5 | own: the world's source-project routing is its subject; hostSourcePath=packages/execution-host | bcf1425523 |
| `…/testing/http/adoptDoor.stest.ts` | itest | Real CLI/HTTP adoption; watcher placed before the producer and keeps events | 9.5 | door {hostSourcePath: packages/execution-host} | 5ba60ba2f9 |
| `…/testing/http/threadChildDoor.stest.ts` | itest | Settings belong to a fresh project, so no separate machine world needed | 8.8 | door {} | 4232406b8a |
| `…/testing/http/commitSteps.stest.ts` | itest | A real program road and commit steps over the shared execution-host world | 8.4 | door {hostSourcePath: packages/execution-host} | d1f7d225de |
| `…/testing/http/worktreeGraph.stest.ts` | itest | A real working-graph door; loan models and scoped live threads | 8.1 | door {} | cdaea69ff1 |
| `…/testing/http/doorFixture.stest.ts` | itest | Two separate worlds and their release are themselves the subject | 7.6 | own ×2: two separate worlds are its subject | d1f7d225de |
| `…/testing/http/threadsDoor.stest.ts` | itest | Scope model memory, account defaults and tokens; current typed place-mismatch | 7.6 | door {} | cdaea69ff1 |
| `…/testing/http/checkoutHistoryDoor.stest.ts` | itest | A real HTTP boundary of git history and cursors already takes the shared world | 7.2 | door {} | d1f7d225de |

## Z6b http-b

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/http/changeRecord.stest.ts` | itest | Real record_write and submit_work under a grant; real threads and scoped project | 7.0 | door {} | 6880949f7f |
| `…/testing/http/reflectDoor.stest.ts` | itest | Reflection, provenance and fix door; independent scoped registrations of source and another project | 6.9 | door {} | 6880949f7f |
| `…/testing/http/doorWorldHosts.stest.ts` | itest | Checks real execution-host finish together with the world | 6.2 | own: closing the world is its subject; hostSourcePath=packages/execution-host | 6880949f7f |
| `…/testing/http/placedCall.stest.ts` | itest | Native and HTTP invocation keep the main/worktree place; two call branches instead of the whole catalog | 6.1 | door {} | 6880949f7f |
| `…/testing/http/agentsDoor.stest.ts` | itest | Kept definition, stale revision and available tools through the door; repeated schemaChars count removed | 5.8 | door {} | 6880949f7f |
| `…/testing/http/threadProjectDoor.stest.ts` | itest | Subject-derived project and place-mismatch on both doors; explicit read of foreign law | 5.8 | door {} | 41cf537600 |
| `…/testing/http/journalDoor.stest.ts` | itest | Journal pagination and a corrupted install through the real door | 5.8 | door {} | 41cf537600 |
| `…/testing/http/instructionRefresh.stest.ts` | itest | The kept definition reaches the next run; scoped project and model | 4.9 | door {} + lent models | 41cf537600 |
| `…/testing/http/settingsPlace.stest.ts` | itest | Foreign law, address settings and approval on independent projects per test | 4.8 | door {} | 41cf537600 |
| `…/testing/http/threadTypeDoor.stest.ts` | itest | Declared agents and their availability through the door; a fresh physical root per test | 4.4 | door {} | 41cf537600 |
| `…/testing/http/modulesDoor.stest.ts` | itest | set_module and the missing software catalog checked by a real operation | 4.4 | door {} | 41cf537600 |
| `…/testing/http/authDoor.stest.ts` | itest | Loopback/device sign-in and console keys; credentials and exact default rows restored | 4.3 | door {} + lent quotaProviders/vendorWire | 60afca0f81; e170ef0671 |
| `…/testing/http/settingsDoor.stest.ts` | itest | Settings pass wire and scope; projects fresh, user power.agentWork restored | 3.7 | door {} | 60afca0f81 |
| `…/testing/http/updateStartsThread.stest.ts` | itest | A real update_worktree creates and reuses the standing thread there | 3.3 | door {} | 4030db2943 |
| `…/testing/http/openingBeside.stest.ts` | itest | The HTTP main graph answers while a neighbor worktree's format step is held | 3.3 | door {} | 4030db2943 |
| `…/testing/http/selectorsDoor.stest.ts` | itest | Alias rename keeps query/search cursor on real doors | 3.2 | door {} | 4030db2943 |
| `…/testing/http/checkoutCommitDoor.stest.ts` | itest | Real git commit, rename, pages and filtering by change record | 2.5 | door {} | 4030db2943 |
| `…/testing/http/graphSync.stest.ts` | itest | First team commit and index keeping checked with real git through sync_graph | 1.9 | door {} | 4030db2943 |
| `…/testing/http/filePreview.stest.ts` | itest | Real foreign files, symlink, MIME and preview boundary through HTTP | 1.6 | door {} | 4030db2943 |

## Z7a landing

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/landing/submitGit.stest.ts` | itest | Real git, hooks, publication races and typed refusals; two red cases fixed | 29.4 | CheckoutFixture {} | 06bd5f4d20 |
| `…/testing/landing/place.stest.ts` | itest | Landing through native and HTTP in a foreign project and checkout with its law and foreign lines | 24.8 | door {hostSourcePath: packages/execution-host} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/mergeHome.stest.ts` | itest | A real merge runs programs from the calling thread in its home; GraphFeed wait | 21.2 | door {hostSourcePath: packages/execution-host} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/steps.stest.ts` | itest | Form steps and hooks change the real commit tree and return edits and refusals | 20.2 | CheckoutFixture {} | 839d0f6f90 |
| `…/testing/landing/submit.stest.ts` | itest | Public landing picks its own and taken paths, keeps staging and finishes records | 10.3 | CheckoutFixture {} | 839d0f6f90 |
| `…/testing/landing/submitReferences.stest.ts` | itest | Native submit_work does not publish a link to foreign uncommitted announcement | 10.1 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/stepsShaping.stest.ts` | itest | The form keeps names, modes and binary data, and a declaration change reruns it | 9.7 | CheckoutFixture {} | 839d0f6f90 |
| `…/testing/landing/submitBindings.stest.ts` | itest | Native submit_work distinguishes dirty imports, shadows and type/value bindings | 8.7 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/submitMigration.stest.ts` | itest | Native submit_work separates a small edit from foreign indentation migration | 8.6 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/submitLines.stest.ts` | itest | Landing cuts its own lines, keeps a foreign index and holds the taken session | 8.4 | CheckoutFixture {} | 839d0f6f90 |
| `…/testing/landing/submitContractMembers.stest.ts` | itest | Native submit_work refuses a member announced only by foreign lines | 8.3 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/submitExternal.stest.ts` | itest | A real HTTP door of a session off Tagma lands explicit paths with correct authorship | 7.8 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/submitDeletion.stest.ts` | itest | A real door lands recorded and explicit deletion hidden by stale fsmonitor | 7.8 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/mergeConclusion.stest.ts` | itest | An observed worktree closes a real merge and merges to main; project now fresh | 7.7 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/interleaved.stest.ts` | itest | Native submit_work carries the command's dependent lines, leaving a working peer's independent lines | 7.6 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/submitBeside.stest.ts` | itest | A real peer merge stays open beside the landing of its own lines | 7.3 | CheckoutFixture {} | 839d0f6f90 |
| `…/testing/landing/submitIndex.stest.ts` | itest | A real index keeps foreign staged bytes and modes and aligns its own | 7.0 | CheckoutFixture {} | 839d0f6f90 |
| `…/testing/landing/submitStopped.stest.ts` | itest | Native-call cancel after publication keeps the commit and a readable receipt | 6.6 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/submitDependent.stest.ts` | itest | Native submit_work carries the peer announcement with the dependent edit of its insert | 4.7 | door {} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/carriedTasks.stest.ts` | itest | A native receipt links carried lines to the task and its holder's state | 4.1 | door {hostSourcePath: packages/execution-host} + LandingRepositorySeed {} | bcc67eedc5 |
| `…/testing/landing/submitMoves.stest.ts` | itest | A git mv command with a later edit lands in one move; new name commandMove.itest.ts | 3.2 | CommandCheckout {} | 839d0f6f90 |
| `…/testing/landing/submitLarge.stest.ts` | itest | Landing two large files finishes the unchanged line; benchmark harness removed, bytes checked by OID | 2.7 | CheckoutFixture {} | 839d0f6f90 |

## Z7b worktree

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/WorktreeFinishing.stest.ts` | itest | Real merge/recovery/retirement; prepared repo residents and queue events instead of deadline polling | 28.5 | graph {repos:[finishing,unavailable]} | 7628b6e49b |
| `server/workspace/repositories/listing.stest.ts` | itest | Coverage/repository identity boundary; projects released through projectLeaving | 14.8 | door {} | 7628b6e49b |
| `…/testing/worktreeMergeModes.stest.ts` | itest | Real merge/squash/rebase and held paths; repo taken from a template | 10.6 | graph {repos:[finishing]} | 7628b6e49b |
| `server/worktrees/branches/rename.stest.ts` | itest | Real branch rename, upstream and remote; project/repo no longer born per scenario | 6.5 | graph {repos:[renames]} | 7628b6e49b |
| `…/testing/worktreeBranch.stest.ts` | itest | Real delete_worktree keeps and reports unmoved commits | 2.5 | graph {repos:[finishing]} | 7628b6e49b |
| `server/graph/tree/merges.stest.ts` | itest | Real index/conflict recovery; template registered and copied per scenario | 2.1 | kind tagma/graph/MergeTemplate(null) | 7628b6e49b |
| `…/testing/WorktreeIgnored.stest.ts` | itest | Real keeping of staged ignored files and deletions on retirement | 1.9 | graph {repos:[finishing]} | 7628b6e49b |
## Z8 enforcement

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `server/enforcement/commitChecks.stest.ts` | itest | CLI checks the index, grant and refusals through the real door | 27.9 | terminal {hostSourcePath: packages/execution-host}; seed copies | 2384f58c43 |
| `server/enforcement/ownGit.stest.ts` | itest | Real commit, merge, pull and graph commit bypass hooks with no reentry | 24.0 | terminal {hostSourcePath: packages/execution-host}; crash-case separate project | ce3b41285f |
| `server/enforcement/landing.stest.ts` | itest | Gate and attribution checked over a real delivery tree and native door | 22.8 | LandingFixtures {lawType: rule} + graph + door {hostSourcePath: packages/execution-host} | 0e1ef7c770 |
| `…/testing/enforcement/absorbCheckout.stest.ts` | itest | Debt of the chosen worktree passes native absorb, submit and merge | 18.2 | door {hostSourcePath: packages/execution-host} | 9f84c506a8 |
| `…/testing/enforcement/configTightening.stest.ts` | itest | Config tightening judged by delivery version and pins escapes with a commit | 17.1 | door {hostSourcePath: packages/execution-host} | 9f84c506a8 |
| `server/enforcement/commitGate.stest.ts` | itest | Real hooks refuse a thread commit and record an operator escape | 14.3 | terminal {hostSourcePath: packages/execution-host}; operator-case separate project | ce3b41285f |
| `…/testing/enforcement/measurementWrites.stest.ts` | itest | A real background pass races absorb before submit and merge | 12.6 | door {hostSourcePath: packages/execution-host, drivers: [remeasure]} | 161e63a683 |
| `…/testing/enforcement/inspectionFailed.stest.ts` | itest | An unavailable worker or graph keeps an honest gate/watch on landing | 11.8 | LandingFixtures {lawType: rule} + graph | 83d77a017d |
| `server/enforcement/commitHooks.stest.ts` | itest | Git hooksPath, linked worktree and hook chain keep a foreign hook | 11.5 | terminal {hostSourcePath: packages/execution-host}; seed copies | ce3b41285f |
| `…/testing/enforcement/remeasure.stest.ts` | itest | The driver applies a persistent journal and attribution to real Git commits | 10.6 | EnforcementWorld {} + graph | e2c0efc06c |
| `server/enforcement/letThrough.stest.ts` | itest; part of tests deleted | Real debt/rename/watch landings kept; tracer-attribute pinning deleted | 10.4 | LandingFixtures {lawType: rule} + graph | 83d77a017d |
| `…/testing/enforcement/remeasureIdle.stest.ts` | itest | Copy opening and closing agreed with measurement before the public operation | 9.8 | EnforcementWorld {} + graph + door {} | e2c0efc06c |
| `…/testing/enforcement/copiedLaw.stest.ts` | itest | Native/HTTP and gate read the chosen copy's law; a branch-only rule is missing in main | 8.4 | door {hostSourcePath: packages/execution-host}; project per case | b80cb91a32 |
| `server/enforcement/heldDebt.stest.ts` | itest | Held debt persists to landing and clears after a real file change | 8.0 | LandingFixtures {lawType: rule} + graph | 83d77a017d |
| `…/testing/enforcement/finishDebt.stest.ts` | itest | A foreign thread immediately finishes the debt owner after native submit of its fix | 6.5 | door {hostSourcePath: packages/execution-host} | 9f84c506a8 |
| `…/testing/enforcement/programsCounted.stest.ts` | itest | Program occurrences judged by the chosen Git tree and line owners | 6.0 | ProgramFixtures {} + graph | 3394dfea88 |
| `…/testing/enforcement/enforce.stest.ts` | itest; logic moved to apps/tagma/server/src/enforcement/contract/wire/checks.test.ts | HEAD, reach, Git lineage and journal stay integration; eligibility operation/phase is unit | 4.2 | EnforcementWorld {} + graph; unit with no world | 5f6ab31d88 |
| `…/testing/enforcement/enforcePrograms.stest.ts` | itest | A prepared measurement linked with real Git sources, resolver and program runner | 3.6 | EnforcementWorld {} + graph | e2c0efc06c |

## Z9 cli

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/cli/hookReport.stest.ts` | itest | Real hook/report protocol; capture already in-process, shared runtime kept | 24.1 | terminal {} | 84c122f471 |
| `…/testing/cli/ensureServer.stest.ts` | itest | Own-server lifecycle; start moved before shuffled bodies, channel isolated with separate HOME/ports | 17.9 | own: server lifecycle is the subject | 84c122f471 |
| `…/testing/cli/mcpInstall.stest.ts` | itest | Declaration install and MCP bridge from a recorded command are real boundaries | 15.2 | terminal {} | 84c122f471 |
| `server/cli/views.stest.ts` | deleted | View-field duplication; an op has no separate view projection | 12.4 | composition/testing/http/blocksDoorFields.itest.ts › a view crosses the wire: saved with its query, opened with its results, rewritten in place; composition/testing/cli/argv.itest.ts › op posts inline JSON and prints the catalog answer | 57652dd382 |
| `…/testing/cli/nativeSignature.stest.ts` | itest | Hand-built runtime replaced with a shared terminal; one CLI spawn; two landing scenarios' independent paths | 11.5 | terminal {} | 84c122f471 |
| `server/cli/upgrade.stest.ts` | itest | A real CLI upgrade reads and fixes on-disk registrations | 11.3 | terminal {} | 57652dd382 |
| `server/cli/projections.stest.ts` | deleted | An op has a single JSON transfer; addressing and reads covered by graph owners | 10.6 | composition/testing/native-harness/graphTools.itest.ts › read_block answers a set in one act, and one unreadable name refuses the whole read; apps/tagma/server/src/graph/contract/wire/identityScale.test.ts:38–44; composition/testing/cli/argv.itest.ts › op posts inline JSON and prints the catalog answer; cli/exitCodes.itest.ts › a refusal exits 2 and prints its complete JSON body | 57652dd382 |
| `…/testing/cli/hookRecord.stest.ts` | itest | The hook door records real changes and repeats; shared terminal kept | 10.2 | terminal {} | 84c122f471 |
| `server/cli/mcpDeclaration.stest.ts` | itest | MCP declaration passes the CLI door; shared world instead of own, env restored | 9.8 | terminal {} | 57652dd382 |
| `server/cli/exitCodes.stest.ts` | itest | Exit codes and refusal/failure distinction checked through the CLI | 9.2 | terminal {} | 57652dd382 |
| `…/testing/cli/mcpServe.stest.ts` | itest | MCP stdio/wire lifecycle; deadline wait and a neighbor test's state assertion removed | 9.2 | terminal {} | c381badea9 |
| `server/cli/project.stest.ts` | itest | CLI keeps cwd/worktree and explicit project; name reading follows its found copy | 9.1 | terminal {} | c381badea9 |
| `…/testing/cli/harnessHosting.stest.ts` | itest | A hosted native door keeps the outcome, cancellation and foreign-law delivery | 8.9 | terminal {} | 57652dd382 |
| `…/testing/cli/hookAdoption.stest.ts` | itest | A real hook wire and ancestry of one CLI process; shared terminal kept | 8.7 | terminal {} | 57652dd382 |
| `…/testing/cli/hookPlace.stest.ts` | itest | Foreign hook law/write checked with each scenario's own thread | 8.2 | terminal {} | c381badea9 |
| `…/testing/cli/argv.stest.ts` | itest | CLI argv, JSON file/stdin, stdout and process exit are the door's own contract | 7.1 | terminal {} | 57652dd382 |
| `server/cli/documents.stest.ts` | itest; part of tests deleted | Kept apply_batch from a foreign cwd; the proposal projection duplicated native graphTools | 6.1 | terminal {}; deleted case: composition/testing/native-harness/graphTools.itest.ts › native reads expose the values a node's tags declare, deferred operations included | 57652dd382 |
| `server/cli/reply.stest.ts` | itest | The reply verb reaches the parked question's owner and prints its refusal | 5.8 | terminal {} | 57652dd382 |
| `…/testing/cli/worktree.stest.ts` | itest | CLI worktree lifecycle; a foreign read creates the record itself, path/project conflict checks the live contract | 5.8 | terminal {} | c381badea9 |
| `…/testing/cli/hookFirst.stest.ts` | itest | A cold project's first hook delivers the rule and explanation through a real door | 4.6 | terminal {} | 57652dd382 |
| `server/cli/terminalDeclaration.stest.ts` | itest | CLI keeps a typed refusal of an incompatible terminal declaration before start | 4.5 | terminal {} | 57652dd382 |
| `server/cli/operatorMechanics.stest.ts` | itest | Named CLI verbs reach their owners | 4.4 | terminal {} | 57652dd382 |
| `server/cli/mcpScope.stest.ts` | itest | Project/user MCP scopes pass the CLI; own removed, user declaration deleted by the finalizer | 3.8 | terminal {} | 57652dd382 |
| `…/testing/cli/hookAdoptionBridge.stest.ts` | itest | Adopted-session signature and refusal/retry through hook/MCP doors | 2.3 | terminal {} | 57652dd382 |

## Z10 graph

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/graph/idleCopies.stest.ts` | itest | Three distinct idle checkouts instead of 30; upgrade, restart and graphless doors kept | 21.8 | own: one install closed and restarted through upgrade | 4710adfadc |
| `…/testing/change-record/budgets.stest.ts` | itest | Benchmark removed; partial cold read, memory budgets, totals, incremental and HEAD retirement kept on 12 paths | 17.9 | SharedPool null | 4710adfadc |
| `server/graph/serving/servingDrill.stest.ts` | itest | Real DB loss, mirror restore, clone and git merge protect persistence | 14.8 | graph; own MachineRecovery null: machine database deleted between opens | 5db34ebfb8 |
| `…/testing/graph/serving/vocabularyFormat.stest.ts` | itest | Tree marker and store format keep read/write compatibility | 12.3 | graph | 5db34ebfb8 |
| `server/graph/serving/lanes.stest.ts` | itest | Opening lane and exclusive storage move checked under real hold with no sleep | 11.9 | graph | 5db34ebfb8 |
| `server/graph/serving/folder.stest.ts` | itest | Global folder, branch law and legacy storage keep files and history | 11.7 | graph | 5db34ebfb8 |
| `…/testing/change-record/programmatic.stest.ts` | itest | Real command rewrites keep indivisibility and authorship on landing | 9.9 | CommandCheckout {} | 755653ad11 |
| `…/testing/change-record/commandLanding.stest.ts` | itest | Real commands, overlap, binary files and symlink pass attribution and landing | 9.9 | CommandCheckout {} | 755653ad11 |
| `…/testing/graph/threadCopies.stest.ts` | itest | A running thread holds its copy, carries the hold and releases at the end | 5.7 | graph | 5db34ebfb8 |
| `…/testing/change-record/threadFiles.stest.ts` | itest | Authorship and HEAD read on real files and SQLite; template and walk worker shared | 8.8 | FileFixtures null; SharedPool null | 03602ac090 |
| `…/testing/graph/vocabulary/neutrality.stest.ts` | itest | Different catalog workflows pass a real HTTP door with no user-default writes | 8.3 | door {} | 5db34ebfb8 |
| `…/testing/change-record/revertLines.stest.ts` | itest | Run undo keeps peer bytes, CRLF, history and CAS admission on a real checkout | 6.7 | CheckoutFixture {} | 755653ad11 |
| `…/testing/graph/work/endingSpecFar.stest.ts` | itest | Native tools name another project's spec only after the last implementer | 6.4 | graph | 5db34ebfb8 |
| `…/testing/graph/serving/mirrorMove.stest.ts` | itest | Mirror move atomically keeps tags and journal, a lost refusal loses no lines | 6.2 | graph | 5db34ebfb8 |
| `server/graph/serving/copies.stest.ts` | itest | A held copy survives eviction and reopens from its mirror | 5.7 | graph | 5db34ebfb8 |
| `…/testing/change-record/stepDebt.stest.ts` | itest | Real format and post-commit debts keep peer bytes and are paid after landing | 5.7 | CheckoutFixture {} | bc2cf066aa |
| `server/graph/serving/concurrencyDrill.stest.ts` | itest | Committed reads answer under held writer and git publication, concurrent acts kept | 4.9 | graph | 5db34ebfb8 |
| `…/testing/change-record/retainedLanding.stest.ts` | itest | A retained nobody-attributed path takes no peer lines without explicit whole | 4.8 | CommandCheckout {} | 755653ad11 |
| `…/testing/graph/writerSessions.stest.ts` | itest | Native doors resolve the holder in the served copy and read writers page by page with totals | 4.5 | graph | 5db34ebfb8 |
| `server/graph/serving/storageMove.stest.ts` | itest | Cross-device move keeps graph handles and foreign files, the conflict target untouched | 3.9 | graph | 5db34ebfb8 |
| `…/testing/change-record/explicitLanding.stest.ts` | itest | Explicit directory selection lands only chosen nobody additions and deletions | 1.6 | CheckoutFixture {} | 755653ad11 |
| `…/testing/change-record/teamLanding.stest.ts` | itest | Team-only command evidence belongs to the team root, foreign overlap not attributed | 1.4 | CommandCheckout {} | 755653ad11 |

## Z11 runtime

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `…/testing/runtimeCancellation.stest.ts` | itest | Build cancel and world close must free real SQLite children | 19.3 | own: acquisition cancel and world close is the check subject | 07d0b5a9f3 |
| `…/testing/native-harness/startCost.stest.ts` | itest | The start card checked against read_agent over HTTP; the missing approver voice fixed | 15.9 | door {}; scoped models, accounts and model defaults | d7b87051cd |
| `…/testing/socket/live.stest.ts` | itest | A real WebSocket checks the answer stream, refusals, ACK and close; runtime shared | 12.8 | door {}; local socket scope | eff4cef4af |
| `…/testing/subjectPlace.stest.ts` | itest | Real doors resolve subjects, foreign links and checkout; stale expectations fixed | 12.5 | door {hostSourcePath: EXECUTION_HOST_ROOT} | eff4cef4af |
| `…/testing/startup.stest.ts` | itest | Startup and status of a real own process checked on open failures | 10.0 | own: startup, bind failure and process death are the check subject | b24a4bb5e5 |
| `…/testing/native-harness/commandOutcome.stest.ts` | itest | A failed real command keeps status and diagnostics in evidence | 9.9 | door {hostSourcePath: EXECUTION_HOST_ROOT}; scoped models | 9ab12be917 |
| `…/testing/native-harness/compactionSummarizer.stest.ts` | itest | A turn through a real harness keeps checkpoint, selection and summarizer choice | 9.8 | door {}; scoped models, quota, accounts, keys and defaults | d7b87051cd |
| `server/installation/closure/workers.stest.ts` | itest | One real bundle checks the closure worker URL and start refusal with a missing module | 9.3 | own: an assembled and damaged installation closure | 258c23c80b |
| `…/testing/native-harness/directoryWarmth.stest.ts` | itest | Decodes the current list_agents answer and checks cache invalidation on an explicitly chosen model | 8.7 | door {}; scoped models, accounts and defaults | d7b87051cd |
| `…/testing/native-harness/evidence.stest.ts` | itest | HTTP evidence checks real SQL, retained output, pagination and placement refusal | 8.2 | door {} | 9ab12be917 |
| `…/testing/place.stest.ts` | itest | Native, CLI and MCP proxy keep the chosen project and recorded place; ToolAnswer unpacked | 8.0 | terminal {} | eff4cef4af |
| `…/testing/restart.stest.ts` | itest; part of tests deleted | One real restart with three threads; the noisy benchmark and duplicate lost-successor case deleted | 7.4 | own: its own server-process change; duplicate: installation/process/launch.itest.ts › a successor that ends after taking the data directory leaves the launch running the build it replaced | b24a4bb5e5 |
| `server/composition/runtime.stest.ts` | itest | Real cold reopens check telemetry and root identity; no reader processes needed | 7.4 | own: cold reopen and different runtimes; ProcessPool(0) | b24a4bb5e5 |
| `…/testing/plugins/agents.stest.ts` | itest | A plugin agent and completion delivery checked with a real plugin process; the stale-pid bind fixed | 7.1 | door {}; scoped models, accounts, defaults and typed plugin uninstall | d7b87051cd |
| `server/mcp/McpServers.stest.ts` | itest | Kept announcements, real MCP pools, lifecycle and app subscriptions checked | 7.1 | graph; a new tenant per case | d7b87051cd |
| `…/testing/native-harness/threadInstructions.stest.ts` | itest | Source verdict checked with real files, keeping one shared runtime | 7.0 | door {}; a separate project | 9ab12be917 |
| `…/testing/native-harness/queryConformance.stest.ts` | itest | One set compares the kernel query with the real activity SQL door | 5.0 | door {} | 9ab12be917 |
| `server/release-channel/runner.stest.ts` | itest | Seven dependent tests assembled into one sequential install journey with no check loss | 4.1 | testing/ReleaseChannel {}; one registry world | 258c23c80b |
| `…/testing/access/rights.stest.ts` | itest | Release composition and access gate checked over real HTTP sign-in boundaries | 4.1 | own: access binding defines the world build | b24a4bb5e5 |
| `server/external-harnesses/runner/opencode/sdk.stest.ts` | itest | A real private CLI checks the hosted wire, session isolation and durable continuation | 3.8 | own: two private CLIs to check separation and reopen | a2182b8cc8 |
| `server/external-harnesses/vendors/opencode/plugin.stest.ts` | itest | One real private CLI checks installed plugin hooks and the MCP wire | 3.7 | own: an installed vendor plugin in a separate HOME | a2182b8cc8 |
| `…/testing/tracing.stest.ts` | itest | W3C parent and repository discovery checked; the exact user layer restored | 3.6 | door {everySpan: true}; unique trace ids | d7b87051cd |
| `server/installation/cut/dmg.stest.ts` | itest | A real ad-hoc signed DMG, mount and installation contents checked | 1.5 | own: a temporary DMG and mount is the check subject | 258c23c80b |
| `server/platform/store/chain.stest.ts` | itest | A real shipped migration chain opened from empty and after close; final path shipped.itest.ts | 0.2 | own: an empty store and cold reopen | 258c23c80b |

## Z12 host

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `packages/execution-host/src/composition/testing/restart.stest.ts` | itest | A real logic change keeps executions, input, output and deadlines; the repeated identical restart cut from 4 to 1 | 12.6 | own: logic restart and deliberately broken start is the file subject | f532cf174b |
| `packages/execution-host/src/composition/testing/logicFailure.stest.ts` | itest | Real-logic refusals and death with a live holder and children | 10.0 | ExecutionBundle null; own: logic change and death | f532cf174b |
| `packages/execution-host/src/composition/testing/programsSwap.stest.ts` | deleted | The vim/less/bash/top matrix repeated checkpoint restore and PTY continuation after a logic change | 9.4 | packages/execution-host/src/composition/testing/logicSwap.itest.ts › continues the screen with its margins, origin mode, bracketed paste, kitty stack and normal buffer | f532cf174b |
| `packages/execution-host/src/composition/testing/programsCrash.stest.ts` | deleted | The same matrix repeated screen keeping and a live process on logic crash | 7.4 | packages/execution-host/src/composition/testing/logicFailure.itest.ts › takes a killed logic up again with every child and the screen it had; packages/execution-host/src/composition/testing/restart.itest.ts › keeps a terminal child alive across logic replacement and resumes output at its previous cursor | f532cf174b |
| `packages/execution-host/src/ExecutionRuntime.stest.ts` | itest; logic moved to packages/execution-host/src/ExecutionStop.test.ts | Real processes and shutdown/retire races keep the 2-record smoke; reuse complete measurement checked deterministically in unit | 7.0 | SharedPool null; own: independent lifecycle scopes, shutdown and held gates | f532cf174b + 8fa6c8e70c |
| `packages/execution-host/src/composition/testing/programsHolderSwap.stest.ts` | deleted | The same matrix repeated the checkpoint on holder change; logicSwap already changes logic and holder | 5.6 | packages/execution-host/src/composition/testing/logicSwap.itest.ts › continues the screen with its margins, origin mode, bracketed paste, kitty stack and normal buffer | f532cf174b |
| `packages/execution-host/src/MachineLoad.stest.ts` | itest | System CPU readings and real-process stop by witness | 4.4 | own: real CPU consumers are the file subject | f532cf174b |
| `packages/execution-host/src/composition/testing/logicReturn.stest.ts` | itest | A real bundle rollback and an old logic's refusal to read a forward-migrated store | 4.4 | ExecutionBundle null; own: bundle activation and return | f532cf174b |
| `packages/execution-host/src/hostProcess.stest.ts` | itest | Real wire, process handles, sampling, pacing and process rules; identical groups share the host | 4.1 | test/HostProcess/World {policy, executions, limits}: 3 profiles; own: crash, saturation, detached launch | f532cf174b |
| `packages/execution-host/src/hostExit.stest.ts` | itest | Process exit, shutdown, signal and writer-claim release | 2.5 | ExecutionBundle null; own: holder/logic exit is the file subject | f532cf174b |
| `packages/execution-host/src/composition/testing/logicSwap.stest.ts` | itest | PTY, pipes, socket, timing and screen modes pass two real logic/holder changes | 2.4 | ExecutionBundle null; own: real logic/holder changes | f532cf174b |
| `packages/execution-host/src/composition/testing/acceptedState.stest.ts` | itest | Holder.launch held to wire Subscribed and queued; after release State gets a decision before Ended; one deterministic run instead of 60 | 2.4 | AcceptedCommand null | f532cf174b + 8fa6c8e70c |
| `packages/execution-host/src/recovery.stest.ts` | itest | A real CLI recovery parses commands, reads the wire and finishes the host | 2.4 | own: recovery shutdown finishes the checked host | f532cf174b |
| `packages/execution-host/src/composition/testing/streamingHandover.stest.ts` | itest | Real streaming output survives handover and stays stoppable under backpressure | 1.9 | own: handover logic and stream state is the file subject | f532cf174b |
| `packages/execution-host/src/posix/departure.stest.ts` | itest | Holder removes a hung logic before starting a successor and keeps the table | 0.8 | own: logic death and reap is the file subject | f532cf174b |
| `packages/execution-host/src/posix/handover.stest.ts` | itest | Holder activates the candidate on logic exit and keeps the real child | 0.7 | own: logic change is the file subject | f532cf174b |
| `packages/execution-host/src/hostDeath.stest.ts` | itest | A real host death leaves readable receipts and changes incarnation with no replay | 0.4 | own: host death and replacement | f532cf174b |
| `packages/execution-host/src/posix/succession.stest.ts` | itest | A real exec holder keeps pid, fd, children and exits on succession and rollback | 0.4 | own: holder succession is the file subject | f532cf174b |
| `packages/execution-host/src/shellHostDeath.stest.ts` | itest | After host death real shell doors, companion result and scope close finish | 0.4 | own: host death in three different caller lifecycles | f532cf174b |
| `packages/execution-host/src/composition/testing/lateLimits.stest.ts` | itest | Welcome on a real socket carries initialized capacity after OS census | 0.3 | own: a separate host with ulimit nofile=36 | f532cf174b |

## Z13 packages

| File | Outcome | Reason | CPU before, s | World / covering test | Commit |
|---|---|---|---:|---|---|
| `packages/tagma/kit/distribution.stest.ts` | itest | The assembled and packed SDK checked outside the workspace; kept bun --no-install test --parallel=1 | 10.0 | own: build/pack of the published SDK is the test subject | 75ac8504d3 |
| `packages/mcp/src/McpPool.stest.ts` | itest; logic moved to packages/mcp/src/McpPool.test.ts | Four pure reconciliation scenarios in unit; the lifecycle of real MCP transports left | 2.4 | own: MCP-pool connect/reconcile/replace/close | 0ef53b1d8c |
| `packages/mcp/src/McpSession.stest.ts` | itest | Real stdio handshake/call/close, environment allowlist and process errors | 1.5 | own: lifecycle of the MCP session and its children | 0ef53b1d8c |
| `packages/mcp/src/McpApps.stest.ts` | itest | A real MCP Apps wire, metadata, resource subscriptions and transport close | 1.0 | own: lifecycle of MCP sessions and subscriptions | 0ef53b1d8c |
| `packages/mcp/src/mcpToolCatalog.stest.ts` | itest; logic moved to packages/mcp/src/mcpToolCatalog.test.ts | Eight pure tests in unit; three stdio paths reduced to one connection | 0.6 | own: one stdio MCP server for the wire scenario | 9a4d6f9f7f |
| `apps/tagma/inspection/src/runners/ruff/ruff.stest.ts` | itest | Conformance of a real pinned Ruff with noqa and error exits | 0.2 | own: an external Ruff artifact and temporary checkout | 75ac8504d3 |
| `apps/tagma/inspection/src/runners/semgrep/semgrep.stest.ts` | itest | Conformance of a real pinned Semgrep; rules.yml restored before each test | 0.0 | own: an external Semgrep artifact and temporary checkout | 75ac8504d3 |
| `packages/adapter-opencode/src/host.stest.ts` | itest | Real private hosts, a shared account DB and stdin leases; integration script and testbed preload added | — | own: two private hosts are the shared-DB check subject | ef69b50993 |
| `packages/agent-tools/src/commandWork.stest.ts` | itest; part of tests deleted | The command lifecycle left through the tool door; mock-argument bookkeeping deleted, marker waits pass fs.watch | — | own: command lifecycle and its record observations | ef69b50993 |
| `packages/agent-tools/src/runtimeSpawner.stest.ts` | itest | A real POSIX-children contract: cost, signals, stdin and env; the prior env value restored | — | own: a separate process is the spawner contract | ef69b50993 |
| `packages/performance/src/CpuProfiles.stest.ts` | itest | A real Bun profiler, profile keeping and global profiler/store close lifecycle | — | own: global profiler and closing the linked store is the test subject | ef69b50993 |
