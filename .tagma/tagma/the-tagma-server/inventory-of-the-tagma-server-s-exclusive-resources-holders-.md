---
id: 01a0df1e-d350-7044-ae18-2973c6c8ba34
title: "Inventory of the Tagma server's exclusive resources: holders, what runs under them, and what waits on the agent's critical path"
ord: 47
tags: ["research"]
fields:
  {
    "source": {
      "name": "runlith checkout",
      "ref": "429b48e0170784b66716d4573a658c228688d779 (2026-09-26, HEAD carries the e11572f0 hook-deadlock fix); telemetry: read_performance retained range ~Sep 25 14:41 UTC → Sep 26 18:40 UTC"
    }
  }
---
# Inventory of the Tagma server's exclusive resources

Checkout read: `429b48e0170784b66716d4573a658c228688d779` (2026-09-26, HEAD carries the e11572f0 hook-deadlock fix).
Scope: `apps/tagma/server/src` plus `packages/sqlite-process`, `packages/git` (no locks found — pure readers/acts), `packages/executions`, `packages/execution-host`, `packages/agent`, and, because the agent's critical path runs through them, `packages/agent-tools`, `packages/mcp`, `packages/llm`, `packages/trace-bundle`, `packages/performance`.
Method: every `Semaphore`/`withPermit(s)`/`take` site, every bounded queue/Deferred gate, every `concurrency: 1` fan-in, file-lock search (`flock|lockf|FileLock|withFileLock|exclusiveLock|lockFile` — no hits in the server). Server side read directly; packages surveyed read-only by helper `locks-packages` from code (its R4 deadlock claim was wrong — refuted below at P4; file lock, MCP gate, flush path spot-checked by me). Telemetry: `read_performance` over retained range ≈ Sep 25 14:41 UTC → Sep 26 18:40 UTC (~28 h), with 919M inherited drops and `partial: true` histograms — tails are lower bounds, absence is not proof.

Counts: **59 resources — 0 standing `deadlock` (1 closed by the fix in this checkout), 32 `stall`, 27 `ok`.**

## Server resources (S1–S30)

### S1 — Tree permit `fresh:{treeRoot}` · `stall` (measured; deadlock loop closed)
| | |
|---|---|
| Guards | One checkout tree's graph material against concurrent refresh/commit/project acts |
| Created | `http/GraphPool.ts#gate:447` — `Semaphore.makeUnsafe(1)` in a process-wide `Map<string, Semaphore>` (`:105`); key `fresh:{treeRoot}` (`http/treePermits.ts#treeGateKey:10`); acquired with span `treePermit.wait` (`treePermits.ts#holding:14`) |
| Holders | `FreshnessGate.fresh` (`FreshnessGate.ts:134`): `syncRegistry` (brief db), `scanTree` fs walk, `ensureFreshMirror` git (rev-parse/status/diff, `files/freshness.ts:47,104`), `repairMirror`/`rebuildMirror` file reads **before** + `act.unit` tx inside (`files/Mirror.ts:169,331,358`); `TreeCommits.commit` (`files/TreeCommits.ts:132`): git add/status/commit (hooks off, `:18,152`), mirror db reads, `branch.observe` → **S8**; `Act.unit` guard on every served-graph write (`graph/core/Act.ts:568-571`, guard = `overRepositoryAndTree`, `GraphPool.ts:466`), incl. shadow-commit landing in post-commit tail **while permits still held** (`Act.ts:557-566` + claim 6c4d656d); `retire` (`GraphPool.ts:283`); `followBranch` git rename (`GraphPool.ts:334`) |
| Foreign work under it | git spawns (own git, `TAGMA_OWN_GIT`, no callable hooks — claim c3dc0e11), fs walks/reads, mirror-writer tx (S4), S8 discharge (→ git + brief machine-writer) |
| Critical path | YES — `touchRule` records every read/edit/write tool call via `Touches.record → act.unit` (`Touches.ts:176`, provided served ctx `touchRule.ts:125`), and `afterTool` is **awaited** in the tool path (`packages/agent/src/agent/AgentToolDoor.ts:1094`); every graph op resolves + `fresh`es |
| Evidence | `treePermit.wait` slowest retained: **360.0 s ×2** (Interrupt — the outer bound), 298 s, 237 s ×2 (Interrupt), 219 s, 100 s, 79 s; parents are `FreshnessGate.fresh` spans of equal length (whole fresh = wait). p99 otherwise ≤ 2 s. The 360 s pair is the reported 6-minute freeze (Sep 26 ~16:50, ~17:03 UTC), pre-fix code: `commit` held the permit while git's post-commit hook called back into the server (`TreeCommits.ts` pre-fix; claim f6e23082). In this checkout the loop is closed: own commits run with hooks off, post hooks wait only for queue admission, staged judgement reads the graph as-stands (claims e7729ae1, c3dc0e11; `enforcement/CommitQueue.ts`) |

### S2 — Repository permit `shadow:{gitDir}` · `stall` (measured ~1 s)
| | |
|---|---|
| Guards | One shadow git dir (stealth/plain; team mode = no-op, `treePermits.ts:38-43`) |
| Created | Same `GraphPool.gate` map; span `repositoryPermit.wait` |
| Holders | `MirrorBuilder.build` attach/switch (`MirrorBuilder.ts:152-159`), journal/legacy `commitAct` (`:184,193`), `replayTopology → syncTopology` git-only (`FreshnessGate.ts:193`, `TopologyMirror.ts` imports only fs/Effect/ShadowGit), `Act.unit` guard, `retire`, `followBranch`. Always taken **before** the tree permit (`overRepositoryAndTree`, `treePermits.ts:45-52`) |
| Critical path | Indirectly — nested inside every S1 guard acquisition |
| Evidence | `repositoryPermit.wait` slowest retained ≈ **1.0 s**; otherwise < 0.5 ms |

### S3 — Entry gate `{treeRoot}` · `stall` (possible, unmeasured)
| | |
|---|---|
| Guards | Pool-entry open/retire per tree (`http/GraphPool.ts:190,278`) |
| Created | Same `gate` map; **no wait span** (`overEntry` uses bare `withPermits`, `treePermits.ts:28-31`) |
| Holders | `acquire → open → MirrorBuilder.build`: repository permit + shadow attach git + mirror store open + `fill` (full tree→mirror read) + `ensureVocabulary` + drain fork (`MirrorBuilder.ts:148-269`); `dropEntry → retire` (→ repository → tree, `:276-290`) |
| Critical path | YES on cold start — every graph op `resolve`s; fast path when held (`:188-189`), full build when absent |
| Evidence | Possible only: first open does git + full mirror fill under the gate while concurrent resolves of the same tree wait; no span measures the wait |

### S4 — Mirror Store writer (one per mirror DB) · `stall` (measured)
| | |
|---|---|
| Guards | All writes to one mirror SQLite file |
| Created | `packages/sqlite-process/src/SqliteProcess.ts:99` semaphore(1); `transactionAcquirer` holds it whole-tx (`:113-120`, BEGIN IMMEDIATE → end; claim 9d7cf310); `Store.transaction` wraps with `Store.permit.wait` / `Store.execute` spans (`db/Store.ts:342-414`), 5 s over-budget warn (`:416-441`) |
| Holders | `Act.unit` tx bodies: graph writes **plus projection of touched block files inside the tx** (claim 6c4d656d — the surviving file-I/O-under-writer, bounded to touched files); `MeasureDrain` passes (prepare outside, settle inside, `MeasureDrain.ts:208-238`); fresh rebuild/repair units; nested `Act.unit` → savepoint (`Act.ts:520-529`) |
| Critical path | YES — touch record per tool call (S1) lands here |
| Evidence | `Store.execute` opKind=`graph` max retained **5.1 s** (opKind does not say machine vs mirror — ambiguity noted); `Store.permit.wait` opKind=`graph` in the same histograms |

### S5 — Machine Store writer · `stall` (measured)
| | |
|---|---|
| Guards | All writes to the machine SQLite file (threads, terminals, worktrees, settings, machine graph) |
| Created | Same mechanism as S4, machine `Store` instance; readers bypass via pool (`SqliteProcess.ts:102-111`) |
| Holders | Every `Units.write` (`db/Units.ts:30-34`, op `thread`): transcript `appendEntries`/`updateAtomically` (db-only bodies, `thread/ThreadStore.ts:347-369`, `ThreadStreamRecorder.ts:299-315,436-458` + no-op `commitReferenced`, `ThreadToolOutputStore.ts:85`), thread lifecycle, `Terminals` register/advance/move, `QuotaReadings`, worktree records, `ThreadEntryBounding` advance/rewrite (files written **before** the unit, `ThreadEntryBounding.ts:190-210` + claim 76f9d7c8), machine-graph `Act.unit` (guard = identity, `GraphPool.ts:54-55` — permits never taken), bare non-declared statements (brief take each, claim ef90b311) |
| Critical path | YES — transcript write per step/pump/end, run lifecycle, terminal acts |
| Evidence | `Store.permit.wait` opKind=`thread` max retained **8.9 s** (cluster of 7 waits 7–8.9 s, Sep 25 ~22:53 UTC); `Store.execute` opKind=`thread` max **6.2 s**. No inversion found: nothing under the machine writer takes a tree/entry permit (machine `TreeFloor.guard` is identity); nested tx = savepoint, not re-take |

### S6 — Inspection lanes ×3 (landing / merge / reach) · `stall` (possible, unmeasured)
| | |
|---|---|
| Guards | One ask in flight per worker (`enforcement/Inspections.ts#lane/permit:35`, `ask:109-121`); lanes split so reach/merge never queue a landing (claim de916dff); idle worker stopped at 60 s, death retried once (`:48-56,113-117`, claims dbb7d715, eeef4de5) |
| Holders | `checks.before` inside S7 submit gate (`submitWork.ts:483`), merge `judged` on merge lane (`WorktreeFinishing.ts:419`), `checkRule` afterTool on **landing** lane (`checkRule.ts:24-33`), `check_rules`/`enforce_rule` ops, re-measure driver. Program rules run on the command road, not the worker (claim de916dff). No wait span on the lane permit |
| Critical path | YES — `checkRule` is awaited after every edit/write tool call (`AgentToolDoor.ts:1094`); submit_work and merges block on judgement |
| Evidence | Possible: documented limitation — "a burst of edits queues ahead of landings on that lane" (claim 74e2e9a6); worker cold start (parser load + empty memo) after each 60 s idle; merge judgements judge whole branches (own lane). Trigger spans exist (`submit_work.before`, `merge_worktree.after`, `edit.after`, claim e380f20f) but lane queueing itself is unmeasured |

### S7 — Submit gate per checkout root · `stall` (possible)
| | |
|---|---|
| Guards | One landing at a time per root (`harness/submitWork.ts#gateOf:27-31`, map keyed by root) |
| Holders | `submitHeld` (`:226-243`): `commitOwn` = build on temp index + `checks.before` (**S6 landing lane**) + git commit + shared-index sync (`:470-501`); `checks.after`/discharge run after release (`:249-266`) |
| Foreign work | S6 judgement (worker + program rules on command road as the session), git |
| Critical path | Landing path (`submit_work` tool), not every turn |
| Evidence | Possible: concurrent submits on one root serialize for the whole build+judge+commit; no wait span |

### S8 — Discharge (HEAD-observer) permit per checkout · `stall` (bounded)
| | |
|---|---|
| Guards | One discharge look at a time (`files/discharge.ts#headObserver/permit:299`, `observe:305-328`); "a movement during a look earns one more" (`looks:330-339`) |
| Holders | Watch nudges (background, `:343-356`), `TreeCommits.commit → branch.observe` while holding S1 (`TreeCommits.ts:156`) → lock order **S1 → S8**. Body: git rev-parse/diff/cat-file/log + brief machine-writer takes (`WorkspaceChangeLog.ts:1693-1711`, bare statements, no tx) + `marked` (lock-free, `CheckoutStatus.ts:256-265,289-313`) |
| Critical path | No direct waiter on the turn path; S1 holder waits on it during every team-tree commit |
| Evidence | Bounded by git reads per HEAD move; no reverse edge (nothing under S8 takes S1/S3 — verified bodies), so no cycle |

### S9 — Checkout readings (3 permits, 30 s deadline) · `stall` (bounded)
| | |
|---|---|
| Guards | Max 3 concurrent checkout git readings server-wide (`working/CheckoutStatus.ts#readings:214`, `bounded:564-577` with 30 s `Effect.timeout`, claims c87f509c, dbea83f9) |
| Holders | `tree()` git status/numstats/untracked-weigh + holder-question db reads (`:579-616`), `comparison()` diffs (`:619-632`); keys coalesce per root+epoch (`:537-562`) |
| Critical path | Marginal — surface subscriptions + `read_checkout`; not per-turn |
| Evidence | Bounded: 30 s deadline stops hung git; queueing folds into `CheckoutStatus.reading`/`comparison` spans (not queried) |

### S10 — CheckoutStatus gate · `ok`
Single process semaphore (`CheckoutStatus.ts:212`); `take` (`:325-362`, map + `roots.read` bare db + fork cycle) / `give` (`:375-392`, pure + forked expiry — the nested `withPermit` at `:385` only *builds* the deferred effect). Brief in-memory holds; no nested waits.

### S11 — ThreadFiles gate · `ok`
Single process semaphore (`harness/ThreadFiles.ts:526`); `take` (`:952-985`, map + root reads + fork cycle) / `give` (`:990-1001`, pure). Surface file subscriptions only; brief holds.

### S12 — GraphFeed publishing per graph · `ok`
`Semaphore(1)` per feed (`graph/journal/GraphFeed.ts:60`); `flush` (`:130-132`) runs post-commit (writer already released) with brief journal/selection reads; serializes overlapping publishes so the watermark never regresses (claim 2b7c38c2). Surface feed only.

### S13 — Settings catalogWrites · `ok`
Process semaphore (`graph/core/Settings.ts:100`); only `land()` of keys with `installs` (the catalogs key, `:441`) → `landOne` installs `#tag` nodes via project-graph `Act.unit` (→ S1/S2+S4) then the row (claim 69f7d9c6). Operator-paced, rare; outermost lock, no cycle.

### S14 — AccountQuota stateGate + subscribersGate · `ok`
Process semaphores (`ai/AccountQuota.ts:166-167`); `withRows` (`:267-268`) holds stateGate across `reconcile` (credential file reads, `:198-265`) + publish. Per-step `observe` rides an async subscription off the step's blocking path (`observeStepQuota.ts`, claim 088b0620); `refresh`/`table`/watch are operator/surface-paced. Brief holds.

### S15 — Terminals execution gates (per execution) · `stall` (by design)
| | |
|---|---|
| Guards | Ordering of agent typing / lane opens / custody transfers into one execution (`terminals/Terminals.ts#executionGates:238`, `gateOf:1166`, dropped at discharge; claim 3c9e1f0b) |
| Holders | Input act (`:1116-1127`): `units.write` register + `typeRegistered` → host lane open + send (`:1130-1151`) + settle; port opens (`:1213`); transfers (`:1395`) |
| Foreign work | Host socket round-trips + brief machine-writer tx (unit-scoped bodies, db-only by `Unit` signature) |
| Critical path | YES for interactive terminal typing (`terminal_input` path); waits queue per execution by design |
| Evidence | Possible; no wait span; no cycle (writer tx takes no further locks) |

### S16 — TerminalInventory flight · `ok`
Single semaphore (`terminals/TerminalInventory.ts:31`); `held`/`refresh` (`:58-93`) do host inventory reads. Only waiter is the background disposition pass (`Terminals.ts:790-791`); listings never wait (claim a4598f8c).

### S17 — terminalsLayer replaceHost flight · `ok`
Single semaphore (`terminals/terminalsLayer.ts:254-256`); serializes host replacements (spawns, long). Maintenance-paced, desired serialization.

### S18 — McpServers gate per project · `ok`
`mcp/McpServers.ts:380-386`; only `poolOf` creation (`:388-410`, in-memory `McpPool.make`). Brief; double-checked.

### S19 — Sandboxes gate per id · `ok`
`harness/sandbox/Sandboxes.ts:413-414`; `bind` (`:168`) and `source` (`:340-358`) — row checks + brief reads. Guest-paced; brief.

### S20 — WorktreeNotes locks per rootId · `ok`
`harness/WorktreeNotes.ts:32,103-110`; `created/setup/merged` (`:36-94`) → `units.read` + transcript `append` (→ S5). Worktree-lifecycle events, not per-turn; outermost lock, no cycle.

### S21 — PendingMerges gate per rootId · `stall` (operator-paced)
`working/PendingMerges.ts:228-235`; queue/drop (`:64,97`) + watch retries `retried → finishing.merge` (`:146,205-213`, uninterruptible). Order: pending-gate → S23 finishing gates → S6 merge lane + git. A try runs whole under the gate (claim 893b024d); waits are merges, operator-paced.

### S22 — ProvisionalBranches lock · `ok`
Process semaphore (`working/ProvisionalBranches.ts:39`); `titled → naming` (`:50-69` read: db reads + standing; rename tail past line 69 unread — INFERENCE from claim 52ebd4a6: git rename under S23 gate, uninterruptible). Fires once per thread title; brief/event-driven.

### S23 — WorktreeFinishing gates (rootId + base-path keys) · `stall` (operator-paced)
| | |
|---|---|
| Guards | One finishing act per worktree; one landing per base checkout (`working/WorktreeFinishing.ts#gates:247`, `gated:878-885`, claim 6a9af974) |
| Holders | `merge`: **nested** `gated(rootId, gated(basePath, …))` (`:365`) incl. `judged` on S6 merge lane (`:419`) + git merge; archive/forget/restore, renames (claim 52ebd4a6), PR incl. `gh` with 2 min bound (claim a1d4ed77), boot `recover` single-key (`:840-843`) |
| Critical path | No turn path; operator/merge-paced |
| Evidence | Single nesting order rootId→basePath; no reverse nesting found; same-key self-take would need rootId == path string (INFERENCE: disjoint — branded id vs absolute path, kept as separate fields e.g. `ThreadFiles.ts:966-971`). Long holds (merge+judge+gh) stall only same-root/base acts |

### S24 — HarnessScreenAsks mutex · `ok`
Per-instance semaphore (`harness/HarnessScreenAsks.ts:110-115`); `observed` (`:121-139`) — job-map mgmt + `Fiber.interrupt` of prior job under `uninterruptible`. Background screen-watch; brief.

### S25 — HarnessMetadata mutex + slots + per-file locks · `ok`
`mutex(1)` + `slots(METADATA_CONCURRENCY)` (`harness/HarnessMetadata.ts:27-34`), per-file `lock` (`metadata/MetadataIndex.ts:23`, `MetadataCommands.ts:21`). `observed` job mgmt (`:40-60`); `watch` takes slots with `METADATA_CADENCE` timeout around CLI-session file reads (`:80-105`, spans `HarnessMetadata.queue`/`.job`). Background reconciliation; measured `HarnessMetadata.queue` max ≈ **30 ms**.

### S26 — Auth sign-in gate · `ok`
Per-handler semaphore (`http/handlers/auth.ts:121`); serializes loopback/device/token flows (`:136,171,217,255,275,309,327,349,367`) incl. one `Deferred.await(ready)` for local loopback readiness (`:156`). Operator-paced sign-ins only.

### S27 — Succession asking · `ok`
Process semaphore (`http/succession.ts:56`); `restart` (`:73-94`) starts the successor process while held, second ask answers decided (claim aaf18d32). Operator/memory-ceiling-paced.

### S28 — AgentPace handing · `ok`
Process semaphore (`power/AgentPace.ts:40`); `hand` (`:49-57`) serializes pace handings (host call) from boot/change/retry fibers. Background; desired.

### S29 — ThreadRollouts waking (Deferred per thread) · `stall` (minor, bounded)
`harness/ThreadRollouts.ts:133-144`: concurrent rehydrate-wakes of one thread `Deferred.await` the first; `wake` = rollout file open + db rehydrate (`:148-164`). Thread open/resume path; bounded by one rehydrate, coalesced, no nested locks.

### S30 — CommitQueue drain · `ok` (serialized by design, not a lock)
`enforcement/CommitQueue.ts:71,98-133`: `draining` boolean + `FiberSet` drains one at a time; `admit` refuses past 1024 (never waits, `:140-142`); `judge` refreshes the graph (→ S1) and retries 3× (`:105-123`). Post-hook calls wait only for admission (claim e7729ae1). Background; desired.

## Package resources (P1–P29; surveyed from code by `locks-packages`, R4 corrected + file lock/MCP/flush verified by me)

### P1 — ThreadSnapshots lane per thread · `stall` (minor)
Map threadId → `Semaphore(1)` + refcount (`packages/agent/src/thread/run/ThreadSnapshots.ts:105-119`); sole holder `publish` (`:121-131`) across store reads + `threadWireDeltas` + `feed.publish`. Feed path (`ThreadAggregate`, `ThreadSpawnTree.ts:380`, `ThreadCompactionRuns.ts:368`, `ThreadEnvelopes.ts:565`); `state/snapshot/page` take no lane. Same-thread publishes queue behind storage reads.

### P2 — ThreadFlushWindow permit per recorder · `stall`
`Semaphore(1)` (`packages/agent/src/thread/run/ThreadFlushWindow.ts:6`); holders `serialize` ← step intent/pump flush (`ThreadStreamRecorder.ts:108-128`), `schedule` timer beat, `close` ← stop. Bodies verified db-only inside `updateAtomically` (events built before, `ThreadStreamRecorder.ts:281-315`; flush adds no-op `commitReferenced`, `ThreadToolOutputStore.ts:85`; PubSub after, `:479-482`). Critical path YES: model-step start (`ThreadTurnRunner.ts:337` per helper), pump flushes, run end → waits behind S5 tx. No wait span — possible, unmeasured.

### P3 — Agent run machine / tool door · `ok`
No semaphore: `ThreadRunLease.ts` (FiberMap + ledger admit), turn-runner Deferreds are one-shot signals, `AgentToolDoor.ts` (writes-map + hooks). Verified by helper.

### P4 — Workspace fileWriters (per path) + directories (per parent) · `stall` (bounded; helper's deadlock refuted)
`packages/agent-tools/src/workspace.ts:146,148,165-169`; order dir-outer → file-inner (`withNamedEntry :171-179`); holders edit/write/delete/import/sweep single-locked; **rename takes both ends sorted** (`rename.ts:38-42`: `parents.sort()`, `files.sort()`, parents outer) — canonical order, so the helper's AB-BA deadlock is impossible (also claim 43e4e074). Tool path; waits bounded by one file op.

### P5 — WebSearchSessions gate · `stall`
Per-instance `Semaphore(1)` (`packages/agent-tools/src/WebSearchSessions.ts:12`); `reach` (`:22-33`) across pool reconcile → connect → session open (stdio spawn / HTTP handshake, `McpPool.ts:112-118,387-397`). Tool path (`websearch.ts:119-121`); order gate → P-passes. Distinct endpoints serialize behind handshakes.

### P6 — ExecutionClient connecting · `stall`
Per-client `Semaphore(1)` (`packages/executions/src/ExecutionClient.ts:253`); `session` (`:73-95`, TCP+hello handshake) / `release` (`:97-105`). All host verbs (`:283-522`); connect/reconnect serializes callers behind the handshake.

### P7 — WireRequests control/walk slots · `stall`
Per-session semaphores (`packages/executions/src/WireRequests.ts:80-82`); `ask` (`:101-125`) holds across send + `Deferred.await` host answer (`:113-114`). Every host verb; walk lane queues behind slow answers. Leaf; bounded interruptible wait.

### P8 — execution-host Execution gate · `ok`
Per-execution `Semaphore(1)` (`packages/execution-host/src/Execution.ts:89-92`); `admitInput/admitCustody/closeBinding` (`:98-157`); screen/summary take none. Leaf; input/custody path.

### P9 — ExecutionRegistry shelf · `stall` (mild)
Host `Semaphore(1)` (`ExecutionRegistry.ts:718`); release-evict (`:3725-3733`), disown (`:4589-4600`), forget (`:4677-4687`) across sqlite writes (`:3741-3754`; fs remove after release). Retire/forget path only.

### P10 — Accepted.revising · `ok`
Per-entry `Semaphore(1)` (`:362,1603`); queued-revise (`:1990-2049` → sqlite) + spawn handoff (`:2705-2725`, Ref-only). Live revise takes `deciding` without `revising`; no pair, no cycle.

### P11 — Custodian handover · `ok`
Host `Semaphore(1)` (`Custodian.ts:194`); take/fence/release/ended (`:241-326`) + resolve (`:352-363`) across admission + sqlite, uninterruptible. Custody-change path; check/current lock-free.

### P12 — Pacing permit · `stall`
Host `Semaphore(1)` (`Pacing.ts:33-35`); hold/change/follow (`:62-118`) across Ref walks + probes + `setpriority` (`:120-155`). Launch path (`pacing.hold`) + pace verb.

### P13 — CallLifetimes.deciding · `ok`
Per-call `Semaphore(1)` (`CallLifetimes.ts:63,154`); revise (`:236-322`) / settle→decided (`:372-409`) across sqlite + timer fork; revise→decided uses Ref directly (`:376-377`), no self-take. Per-call scope.

### P14 — ExecutionRecord segment gates · `ok`
Per-handle `Semaphore(1)` (`ExecutionRecord.ts:179-186,863`); read window = one seek+read (`:806-815`); append single-producer by refusal (`:539`). Leaf; record reads.

### P15 — ProvenSet set→tables permits · `stall`
Tables permit host-wide (`ProvenSet.ts:53-55`, 50 ms cache `:58-69`) + set permit per execution (`:270,286`); stop-ladder rounds across probes + `tables.read`. Single order set → tables, never reverse. Stop path.

### P16 — ProcessUsage rounds · `ok`
Host `Semaphore(1)` with try-acquire, skip-if-held (`ProcessUsage.ts:119-125,181`). Sampling only; readers lock-free.

### P17 — HostConnections seats/spare/credit · `stall` (backpressure by design)
`seats(connections)` + `spare(1)` taken with `takeIfAvailable` only (`HostConnections.ts:255-256,747-751`, never wait, held for conn lifetime); per-reader `credit(granted bytes)` (`:402-407`) — `push` (`:346-381`): credit → `ConnectionWriter.account`; replies take none (`:732-740`). Feed-delivery path; socket backpressure by design.

### P18 — ConnectionWriter account · `ok`
Per-conn `Semaphore(eventBytes)` (`ConnectionWriter.ts:61`); sole holder `event` (`:80-86`, release after socket write `:125-131`); `reply` takes nothing.

### P19 — EvidenceScans gate · `stall`
Host `Semaphore(concurrency)` (`EvidenceScans.ts:218-220`); `run` (`:292`) across probe listings + revision bump; join-or-crowded flight map. Sampler/remeasure reads. Leaf.

### P20 — PipeStdin writer · `stall` (backpressure by design)
Per-execution `Semaphore(1)` (`PipeStdin.ts:81`); `write` (`:88-106`, awaits consumer pull) / `end` (`:112-121`); pull/ended lock-free, death fails waiters. Pipe-input path (admitInput → sink.write).

### P21 — McpPool passes + per-server gate · `stall`
`passes(1)` (`packages/mcp/src/McpPool.ts:81`), holder `reconcile` (`:112-118`) across teardown + connect/spawn (`:305-397`); per-server `gate` (`:359`), holders slow-path call (`:152`) + refresh (`:425`, verified lines 425-441 — fallback at `:440` mints a throwaway when the entry is gone, i.e. no exclusion then, safe by the identity re-check inside). Fast path gateless (`:148-151`); worker never takes the gate. Reconnect-path MCP calls + P5 websearch. No cycle (no gateOf inside passes).

### P22 — FileTokenStore refreshGates · `stall`
Per provider/account `Semaphore(1)` (`packages/llm/src/oauth/FileTokenStore.ts:51,201-205`); `refreshOnce` (`:206-210`) ← expiring-token reads (`:145-164`) across file-lock → readFresh → **network** refresher (`:244-246`) / CLI read (`:269`) → commit. Order refreshGate → refresh-lock → writes → main-lock; plain ops take writes → main, consistent. Model path when a bearer is expiring; accounts parallel. File-lock wait bounded → `LockBusy` (`fileLock.ts:10`, verified header + claim 2a2169e5: stale takeover only for dead holders).

### P23 — CredentialFile writes + cross-process .lock · `stall` (mild)
Per-file `Semaphore(1)` (`CredentialFile.ts:36`) + lock-file protocol (`:39-41`, `fileLock.ts` — the only OS-level file lock in scope: lock file + heartbeat + stale takeover, bounded wait). Every cred op via `guarded` (`:89-98`); fast path on cache stamp takes no lock (`:43-65`); refresher runs between read and commit, never under `writes` (`:221-249`). Order writes → file-lock.

### P25 — TraceBundles locks + retention · `ok`
Per-runId locks (`packages/trace-bundle/src/TraceBundles.ts:94,241-247`) + `retention(1)` (`:95`); `submit` wraps all bundle-fiber work (`:389-391`); single order bundle → retention. Never awaited by turns (drain at shutdown only).

### P26 — PerformanceStore gate + readGate · `stall` (reports only)
`gate` (`packages/performance/src/PerformanceStore.ts:376`) + `readGate` (`:499`); `read` (`:386-411,1021-1087`) across worker IPC + `REPORT_TIMEOUT_MS`; losses-live bypasses (`:1014-1020`). Report path, not step path (INFERENCE).

### P27 — CpuProfiler / CpuProfiles gates · `stall` (explicit captures only)
`CpuProfiler.ts:55` (init/timer/cut/window; sleep between permits `:177`); `CpuProfiles.ts:44` — `capture` (`:48-91`) across `profiler.window` incl. requested-duration sleep + `store.flush`. Order profiles → profiler. By design.

### P28 — sqlite-process writer semaphore (mechanism) · `stall` (by design; instances are S4/S5)
`SqliteProcess.ts:99-100`; tx holds whole-life (`:113-120`); bare statements take only to be handed the connection (`:100`, claim ef90b311 — the documented deadlock avoidance); reads route to pool with writer fallback (`:102-111`); `export`/`loadExtension` take it (`:137-139`).

### P29 — ReaderPool FIFO (no semaphore) · `ok`
Claimed-counter + turn Deferreds (`ReaderPool`: `:62-99`); `take` (`:46-59`) fast path or interruptible FIFO await with withdraw; exhaustion waits, never refuses; open-miss spawns a reader inside take. Declared-read path (ceiling default 4); interrupt-safe, no lock, no cycle.

## Lock-order pairs (A held while acquiring B)

Server: entry → repository (open, retire); entry → repository → tree (retire); repository → tree (Act.unit guard, replayTopology, followBranch); tree → mirror-writer (fresh units, Act.unit tx); tree → discharge-permit (TreeCommits.commit); discharge-permit → machine-writer-brief; catalogWrites → {repository,tree} → mirror-writer; submit-gate → landing-lane; finishing(rootId) → finishing(basePath) → merge-lane; pending-gate → finishing-gates; provisional-lock → git + machine-writer (finishing-gate nesting INFERENCE); checkout-gate/threadfiles-gate → brief machine reads; execution-gate → machine-writer + host socket; worktree-lock → machine-writer; flush-window(P2) → machine-writer.
Packages: dir-lock → file-lock (canonical sorted, rename too); WebSessions.gate → McpPool.passes; refreshGate → file-lock → CredentialFile-writes → main-lock; bundle-lock → retention; profiles-gate → profiler-gate; set.permit → tables.permit; credit → writer.account; shelf/revising/deciding/handover → host sqlite; slots/connecting/gates → host answers/socket (leaves).
**Cycles: none standing.** Closed in this checkout: tree → tree self re-entry via post-commit hook callback (pre-e11572f0). Refuted: agent-tools rename AB-BA (sorted, `rename.ts:38-42`).

## Ranked top dangers

1. **S1 tree permit — measured 360 s freezes; every file tool call waits on it.** `touchRule` (awaited `afterTool`) records each read/edit/write via `act.unit` under the tree guard, and every graph op `fresh`es. Two retained 360 s waits (Interrupt) + 79–298 s more. The hook-callback deadlock is closed in this checkout; the stall shape remains: one holder (team commit git, fresh rebuild, Act.unit incl. landing git) parks every agent at once.
2. **S5 machine writer — measured 8.9 s waits / 6.2 s holds on the transcript path.** Every step/pump/end (`updateAtomically`, `appendEntries`), run lifecycle, terminal acts, bounding and settings contend for one writer. Bodies are now db-only on the hot paths (spool/bounding files land outside units) — length comes from contention and statement cost, not foreign work.
3. **S6 landing lane — awaited after every edit/write, unmeasured.** `checkRule` judges each edit/write on the landing lane; a burst of edits queues ahead of landings (documented limitation); worker cold start after each 60 s idle. No wait span exists — the queue is invisible.
4. **S4 mirror writer — projection file I/O still inside the tx by design.** `Act.unit` projects touched block files inside the transaction (rollback coherence); measured `graph` executes to 5.1 s; every touch-record contends. Bounded to touched files, but one slow disk + one big act = every graph waiter.
5. **S3 entry gate — first-open blocks concurrent resolves, unmeasured.** A cold `resolve` builds the whole mirror (git + full fill + vocabulary) under the entry gate; `overEntry` has no wait span. Rare per tree, unbounded when it hits.

Honest gaps: `harness.touch` has no retained spans (touch waits unmeasured directly — only the underlying `treePermit.wait` is measured); no wait spans for S3/S6/S7/S15/P2/P4/P7; `Store.*` spans cannot split machine vs mirror DB (only opKind); per-helper package findings except R4/fileLock/MCP-gate/flush/tool-output paths, which I verified; ProvisionalBranches tail, TerminalStore bodies and FileRoots.read characterized from signatures/claims (marked INFERENCE where load-bearing).
