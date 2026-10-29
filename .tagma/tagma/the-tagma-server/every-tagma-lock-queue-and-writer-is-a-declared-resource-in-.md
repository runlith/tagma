---
id: 01a0e2a3-49a3-7e17-b24c-0979511b13e3
title: Every Tagma lock, queue and writer is a declared resource in one refused-if-broken order; an agent's call waits only for its own work, every wait has a derived ceiling with an absolute cap, and cost follows what a call touches
ord: 53
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
---
# Tagma architecture spec · Section 3. Execution — draft v5

**Amended by §3.13 ([[9c085c6c]], its §3.13.15):** §3.4.1 — a CPU token only while a pure job runs, `held`-class token waits allowed under a hold, rank 420's external call "none, except `held` waits for its own hash chunks"; §3.4.4 — one arbiter grants the heavy slots to pure jobs and impure executions; §3.4.6's workers become §3.13.7's protocol; ranks 240/241 become journal-lane entries; `took` = T4 − T0; `replayed` and `spent` outcomes. §3.13 governs where this text differs.

**Amended by section 5 ([[243fd181]]), approved by the operator:** the graph's P3 commit is a **sync** — "P3 capture and sync" (§3.11), the act phase `synced`, the sync unit; the module `delivery` is `landing`. Version notes above §3.1 keep the words they were written with.

**Amended by section 1 v10 ([[f658e190]]), approved by the operator:** owners renamed and moved — `delivery` owns landings, preservation commits, merges, the merge queue and `MergeNotice` (ranks 110, 280, 290); `threads` owns the worktree notes lock (130), with notes written into each thread's journal with revisions, and keeps the rollout lane (export, rest, wake, repair) for every thread with native-harness's folds as a participant; `native-harness` takes ranks 240/241 and the delivered key; `executions` replaces `terminals`; `external-harnesses` and `providers` take their in-memory gates. New: the archive intent and its recovery pass in `worktrees`, the `Harness.quiet` admission lease, and after-edit through `ThreadExecution.afterEdit`; figures are derived by platform from installation's inputs, not by `composition`. Each change is marked where it applies; section 1 v10 §1.13 is the source.

v5: closes spec-review-03v4-arch-{opus,astra}.md's blockers. Nothing rejected.
- **Hooks (Opus B8).** A per-checkout hook lane (rank 280) runs one landing's hooks at a time. The caller holds nothing while it waits, and the wait counts against the landing's deadline. The origin rule covers a lane its origin is **in or** waiting on, so a hook calling `submit_work` on its own checkout gets `reentrant` at once.
- **Receipts (Astra 1).** A missing reflog entry proves nothing. `abandoned` is proved only by order, meaning the landing never reached its durable `publishing` witness. Anything else without a positive receipt is `uncertain` — for landings, safely resolved by running `submit_work` again — and for merge phases likewise.
- **Index settlement (Astra 2).** Its outcome is decided by reading the ref **after** the atomic rename. A ref moved before the rename yields `unsynced`; no pre-rename re-read is claimed to close the window.
- **P3 in the lane (Astra 3).** P3 goes through step 2 with a bound `(ref, prepared base, tree)`, and a moved head exits the lane for §3.11's intersection rule. The hook and commit lanes are the `platform` git kit's mechanisms, built in E0, so `graph` uses them in E2 without importing `delivery` ([[f658e190]]).
- **Debt (Astra 4).** A ceiling-hit subject is never written into debt. The `unblock` is to fix the builtin, or to loosen openly through `enforce_rule`'s own contract: watch, or removing the trigger.

v4: closes spec-review-03v3-arch-{opus,astra}.md. Nothing rejected.

**Landing and publication (Opus R1/R2, Astra S3-2/S3-4).**
- The commit lane runs git plumbing only: the ref check, `commit-tree`, `update-ref` on the recorded symbolic ref, and `index.settle`, all inside one step.
- Hooks, rebuilds and re-judging run outside the lane with no hold. A moved base or ref exits the lane and re-enters at the landing's original position, under `ATTEMPTS` and the total deadline.
- A callback carries its origin and refuses `reentrant` instead of closing a cycle. That applies to MCP connects too.
- The publication receipt is a reflog entry naming the job. Recovery reads the recorded ref and its reflog. With no proof either way the landing is `uncertain`, never `abandoned`.
- Index settlement re-reads the ref before its rename and never records `synced` over a moved ref.
- Team-mode P3 publishes through the same lane.
- Git older than 2.36 refuses before anything is published; the unsafe fallback is withdrawn.

**Merge (Astra S3-12).** Recorded phases with result commits, recorded source sha, per-ref resolution from reflogs, and `uncertain` instead of patch ids.

**P3 (Astra S3-3).** Filtering removes whole closures. An act lands only when all its paths are satisfied.

**Time bounds (the operator's rule, Astra S3-13/14, Opus §3.12).**
- `busy` is an admission refusal. `stalled` carries `outcome: none | uncertain`.
- A running unit is stopped by killing and reopening its writer child with the permit fenced. It answers `uncertain` with its key when the kill came after COMMIT.
- Units that close committed effects are `recovery` and never withdrawn.
- T_ask is per builtin, capped at 120 s, with an input envelope. Its unestablished parts are stated.
- Background `measure` asks are never dropped by a wait ceiling.
- A `ceiling` refusal names its `unblock`.
- Every wait has a whole-wait deadline, retries included, and an absolute cap: 15 min, or 30 min for a model request. None is open-ended.

**Memory (Opus).** E0 measures whether `bun:jsc`'s commit figure includes worker heaps, and otherwise switches to process RSS.

v3: closes spec-review-03v2-arch-{opus,astra}.md, with nothing rejected, and builds in the operator's word that every wait has a sane upper time (§3.12, an amendment to [[b9bdfa95]]). Changes:

**Landing (Opus B7, Astra S3-4).**
- Building and judging stay parallel. The commit step runs one at a time per checkout, in a commit lane where the caller holds nothing.
- The commit is a real compare-and-set against the judged base: `commit-tree` with a single explicit parent, then `update-ref HEAD <new> <base>`. User hooks run through `git hook run`.
- The publication witness is the commit id, written durably before `update-ref`, plus a `Landing` trailer.
- `busy` is allowed only while nothing is published.
- The index tail settles per path, and only where HEAD still holds the landed blob; otherwise the path is `superseded`.
- Certificates hold evidence for both the base and the built side, including negative reads.

**Ceilings.** Every inspection ask, every lane wait and every other call wait has a derived ceiling. Crossing it is a typed defect answer with a stall record.

**P3.**
- The batch is closed under the latest projected writer of every path. A batch over the byte budget spills to a private copy.
- A lost compare-and-set checks which paths the new head changed before it reuses any blob.

**Callbacks and capacity.**
- MCP and web-search calls hold no gate during the call.
- Capacity comes as phase-scoped tickets, released before any wait on another party or any callback-capable call.
- Forked fibers inherit live hold tokens, and a hold's scope ends its children.

**Writer.** A class-level weighted rotation replaces per-unit aging. Large units progress under background aging.

**Memory.** One process-plus-children model with no double counting. Envelopes are reserved at admission, and growth is honestly soft accounting with defined recovery.

**Merge.**
- The pending gate covers only a short claim.
- A `running` merge carries a request witness before its git effect, and cannot be cancelled.
- Rollback turns `running` into `stopped`.

**Opus non-blocking.**
- Graph leases are per call.
- `enforce_rule` bumps `law_revision`.
- D9 must show the server under 0.6 × M.

**Correction.** The line on which checks share the landing worker is corrected: whole-reach measurement uses the reach worker.

v2: closes spec-review-03-arch-{opus,astra}.md, and builds in two decisions already made:
- the tree permit is held from P1 through P2, and P3 holds it only for byte verification — §3.11, an amendment to §2.4.8;
- no inspection deadlines ([[b9bdfa95]] stands).

Changes:

**Wait contract.**
- The contract is honest: no call waits for another agent's scenario to complete. Contention on shared resources is bounded and stated, with one aging rule for every class.
- Writers never refuse. `busy` is only at entry points, before any effect, and is judged by expected wait time.

**Lock order.**
- The order is enforced by refusal in production too.
- The real nestings are ranked: finishing, pending merge, provisional branch, workspace locks, credential locks.
- The thread run is a fence, not a lock.
- Rules are stated for fork, join, capacity and pass waits.

**Graph writes.**
- The freshness fast path uses observed and applied epochs.
- The watcher API reports known paths or a rescan.

**Landing.**
- Parallel judgement uses up to the heavy slots available to calls.
- Verdict reuse goes through judgement certificates built on `Inspected.read`; the boolean `GateMemory` has no hashes and is not used for this.
- `git commit` keeps its hooks, and HEAD is its own compare-and-set.
- A durable `landing` intent covers the tail after the commit.
- Index settlement runs under git's own `index.lock`, owned by a `platform` git kit.

**Other changes.**
- `checkRule` always enqueues. Enforcement owns the trigger projection, keyed by store and by the law, GLOBAL law and vocabulary revisions.
- There is one Tagma memory budget covering the server, its children and its workers, with charges taken before allocation.
- Capacity and passes have defined lifetimes and recovery reserves.
- Instruction delivery is keyed to the context epoch.
- Doctor territory is bounded by its affected closure.
- The static rules are scoped to the serving isolate, and their debt is measured by their first run.
- `hot-reads-indexed` is a test run at merge.
- Telemetry: writer attribution by permit token ([[291cc685]] as it stands); a new metric record contract; sampled-span percentiles are marked as biased.
- The OS-lock transition is fenced by the machine chain, and the succession handshake keeps its order.
- D9 attributes loop CPU by owner before opening the worker decision.
- The merge queue reuses `worktree_pending_merge` and the existing `WorktreeMergeQueued` answer, with a durable notice through a port.
- Reference fixes:
  - section 2 references corrected (kit §2.4.11, host §2.4.10);
  - the catalog driver is owned by `graph`;
  - the performance ledger is read through `read_performance`.

Rejected: none. The stray sentence reported at v1 line 259 ("another commit was running in this checkout; run it again.") is not in the file: `grep` finds no match. It is a line injected into tool output (it is `harness/submitWork.ts:71`'s message), and it appeared again in this revision's reads. Nothing in the file was removed for it.

Builds on:
- section 1 [[f658e190]] (modules, order, two-phase start);
- section 2 [[70083b67]] (owners, write classes C1–C4, one machine writer until D9, durability classes, graph act phases, transcript deltas, budgets, reserve file, WAL limit);
- section 8 [[e04cfdcb]] and section 9 [[6bf40362]];
- decision [[b9bdfa95]] (rule checks carry no enforcement budgets), amended by §3.12 on the operator's word: no per-rule budget setting, and a derived ceiling on every ask and every wait.

Evidence was read at HEAD `db306cc84d` (2026-09-27). One process sample from the operator's machine is reported as a sample ([[fe83acfa]]).

## 3.1 Outcome

Twenty agents working one installation see these properties:

- **No tool call waits for another agent's scenario to complete.**
  - Not for its landing, its merge, its judgement or its graph act's publication.
  - Not for a re-measure, a doctor sweep, an export, a rest or telemetry.
- **Waiting at a shared resource is bounded and stated.** A call does wait its turn at a shared resource: the machine writer, a graph store's writer, a tree's permit for one act's P1–P2, a heavy slot, a reader. That wait is bounded by the rules of §3.4.1–§3.4.2, measured and attributed to its holders.
- **One enforced lock order.** Every lock, permit and queue has an owner, a rank in one order that refuses violations, a hold threshold that writes a stall record, and wait, hold and queue measurements.
- **Background work runs under one budget.** It runs through one scheduler per owner, under one machine budget, with a reserve that recovery alone may use.
- **Cost follows what a call touches.** A touch, an instruction step, a closure or a doctor concern reads in proportion to its affected set and its output, not to the corpus.
- **The serving loop does no synchronous disk or process work** after admission. Its lag and its CPU owners are measured.
- **Budgets follow the machine.** The lowest supported machine (2 physical / 4 logical cores, 8 GiB, SSD; §2.11) runs the same rules with smaller figures, derived at runtime.

## 3.2 Problem

The inventory [[c6c8ba34]] counts 59 exclusive resources: 32 can stall and none is a standing deadlock. The rows below are rechecked at `db306cc84d`.

| # | Finding | Evidence now |
|---|---|---|
| F028 | Every graph operation takes the tree permit even on a clean tree, and long holders keep it past the SQL commit. | `http/FreshnessGate.ts:134-137` reads `dirty` inside `overTree`. Every resolve calls `fresh()` (`http/caller.ts:237`, `GraphRouting.ts:52-54`, `runtime.ts:366,371,508`, `handlers.ts:192`). `graph/core/Act.ts:568-571` guards every served write, and its `onCommit` tail (`:557-565`) runs the landing inside the guard. `files/TreeCommits.ts:132-163` runs `git add -A`, `status`, `commit` and `branch.observe` under the permit. Measured: `treePermit.wait` 360 s ×2 before `e11572f0`; at most 0.46 s afterwards, in Opus's window. |
| F029 | The after-edit check waits on a lookup that can open a graph, and every check shares the landing lane. | `harness/capabilities/checkRule.ts:22-33` awaits `checks.after`. That waits on `wanted`, a 60 s TTL index (`enforcement/checks.ts:159-193,228-235`). A miss resolves the graph (`runtime.ts:367-373`); a read failure is cached as the empty set for 60 s (`checks.ts:172-191`). After-edit change judgements ask the **landing** worker (`judge.ts:63`, `Inspections.ts:135-142`), so a `submit_work` judgement queues behind them ([[74e2e9a6]]). Whole-reach measurement asks the reach worker instead (`enforcement/measure.ts:97-111`). A lane is one worker with one ask in flight (`Inspections.ts:29-35,109-120`), and its wait has no span. |
| F030 | Nothing bounds the aggregate cost of served graphs, tools, jobs and processes. | `http/GraphPool.ts:103-106`: entries and a gate map that never evicts or shrinks; a tree leaves only by release, stale identity, retire or shutdown (`:241-290,443-448`). The step fan-out is `concurrency: 'unbounded'` (`packages/agent/src/agent/turn/tools.ts:176,262`). Readers open lazily (`packages/sqlite-process/src/ReaderPool.ts:50-55,124-139`). The restart ceiling measures only the server's own committed memory (`packages/performance/src/ProcessVitals.ts:39,101`; `http/main.ts:68,134-140`); its children are outside it. Sample: server RSS 2.06 GB beside 17 SQLite children of 17–146 MB each, about 1.1 GB together. |
| F031 | Local acts re-read the corpus. | Every touch runs `regionsOfPlace` (`graph/orientation/Orientation.ts:243-278`), which reads all dir and file sources of the project and all its blocks' parents, and `lawForest` (`:280-303`), which reads every law row. `source` has no index on `ref` (`db/schema.ts:164-172`). `frontierLine` repeats `rows.find` (`:219,223`). `collectDescendants` issues one query per node (`Act.ts:723-735`); Fable counted 1.17M `childrenOf` calls a day. `Doctor.concerned` territory reads every block of the affected projects (`graph/measure/Doctor.ts:758-783`). The touch rule scans the model transcript on every call (`touchRule.ts:30-36,95-96`). `beforeStep` recomputes instructions (`harness/agents/composeAgent.ts:166-181`). |
| F032 | The data-directory claim can race. | In `http/claim.ts:45-57`, two starters that both read a dead pid can each remove the other's fresh file with `rmSync` and succeed with `wx`. Claim [[d6b526bc]] is false; both reviewers confirm it. Process-local queues rely on the claim: the gate map, `CommitQueue`, the performance ring. |
| F033 | Synchronous I/O runs on the loop. | A server-only grep census finds 387 synchronous `fs`/`child_process` calls in 77 files, outside tests, `cli/` and `install/`. They include `touchRule.ts:69` (`readFileSync` of the whole file on every edit) and `CommitQueue.ts:78-90` (`openSync`/`writeSync`/`fsyncSync` on every admit). The census is not the rule's baseline; §3.4.9 measures that. |
| F027 | The machine writer carries the transcript and foreign domains. | Section 2 decides it. This section adds priority classes and aging (§3.4.1). |
| F081 | Telemetry loss is unmeasured, and percentiles come from a biased sample. | Spans are dropped first (`packages/performance/src/PendingQueue.ts:153-158`), with counts per kind (`PerformanceStore.ts:631-656`). The sampler keeps slow, failed and stalled spans in preference (`TraceSampler.ts:190-197,220-223`), so percentiles over retained spans are biased and **not** a lower bound. Metric snapshots keep only span-duration histograms and failure counters (`MetricSnapshots.ts:20-68`). The writer window's remaining attribution gap is [[291cc685]]'s limitation: the settlement window ends after the writer is released. |
| F012 | The lesson of the hook deadlock. | Fixed by `e11572f0` ([[e7729ae1]]). The shape remains: one permit held across git and entered by calls. |

**Root cause.** The wait graph is not a designed object. 64 `Semaphore.make*` sites stand in 53 non-test files of the server and packages, plus gate maps and single-flight flags. They are made ad hoc, in one class, with no priority. A hold across git, or a whole-corpus read, is invisible until it freezes everyone.

## 3.3 What holds now

**Kept orders.** These orders come from domain identity:
- one running run per thread — a persisted fence, `db/thread.ts:303-312` and `packages/agent/src/thread/run/ThreadRunLease.ts:168-184,243-288`, not a held lock;
- the flush window (`ThreadFlushWindow.ts:6`);
- the snapshot lane (`ThreadSnapshots.ts:105-131`);
- per-execution input and custody (`terminals/Terminals.ts:238,1166`);
- workspace directory→file locks, with renames taking sorted sets (`packages/agent-tools/src/workspace.ts:146-179`, `rename.ts:31-43`).

These are not bottlenecks to remove (Astra §6.3).

**Work already off the loop.**
- SQLite children (`packages/sqlite-process`);
- inspection workers;
- the measure worker;
- the execution host;
- the performance store worker.

**Coalescing already present.**
- After-edit checks per (project, root, op, thread) within 2 s (`Remeasures.ts:252-283`).
- Re-measure slots per (checkout, rule) (`:182-190`).
- Tree commits after 10 s quiet and 120 s at most (`TreeCommits.ts:22-24,166-183`), which section 2 replaces.
- The discharge observer's one-more-look (`files/discharge.ts:330-339`).
- Checkout readings: 3 at once, with a 30 s deadline (`working/CheckoutStatus.ts:214,564-577`).

**Typed bounds already present.**
- The commit queue: 1024 entries per project (`CommitQueue.ts:153-158`).
- Host seats: 6 plus 1 (`HostConnections.ts:255-256`).
- Wire slots: 2 control and 4 walk per connection (`packages/executions/src/WireRequests.ts:80-82`).

**A merge queue already exists.**
- `merge_worktree` with `queue` first tries the merge whole under the root's pending gate.
- On `base-held`, `base-staged` or `base-mid-operation` it stores a `worktree_pending_merge` row, one per worktree root, and answers `WorktreeMergeQueued` (`working/PendingMerges.ts:17,57-91`; `db/worktrees.ts:62-77`).
- A watcher retries on base movement and every 2 minutes (`:130-192`).
- No notice reaches the requesting thread when the merge lands; only the project surface moves.

**`submit_work` today.**
- It builds on a temp index and judges.
- It commits with `git commit` under `GIT_INDEX_FILE`, which runs the user's hooks.
- It retries when HEAD moved (`harness/submitWork.ts:470-521`), all under a per-root gate (`:27-31,226-243`).
- It then syncs the shared index in separate git calls (`:699-747`).

**Other conditions.**
- Hook callbacks wait on no tree permit ([[e7729ae1]]).
- Loop stalls over 100 ms are recorded (`http/runtime.ts:152,192`).
- The watcher drops events that name no file (`working/TreeWatch.ts:73-77`).
- Undeclared reads, and failed pool takes, fall back to the writer (`packages/sqlite-process/src/SqliteProcess.ts:99-111`).

## 3.4 Target model

### 3.4.1 The wait graph

**`Held`.** A package, `packages/held`, provides `Held` (exclusive resources), `Flight` (single-flight results a caller may join), `Passes` and `Capacity`. The server and the shared packages both use it; per [[8183e6ef]] nothing re-exports it.

A resource declares:
- its **name** and **owner module**;
- its **rank**;
- its **key shape**;
- its **concurrency**;
- its **hold threshold**, which writes a stall record and cuts nothing;
- its **ceilings**, for the hold and for a call's wait, derived per §3.12, with what the cut leaves. A resource that cannot state a defined state after a cut cannot be declared.
- its **queue**: FIFO, or classes under the weighted rotation below;
- whether a hold may cross an **external call** (git, network, spawn, a worker or host ask). If it may, it also declares whether the callee can call back into this server.

A keyed gate is removed only when it has neither holder nor waiter. The unbounded gate map of `GraphPool.ts:105` goes.

**The order is enforced by refusal, everywhere.**
- A fiber holds ranks in strictly increasing order.
- A fiber carries the set of **live hold tokens** it and its ancestors hold.
  - A fiber forked inside a hold inherits the tokens of that hold.
  - The hold's scope owns such children: releasing the hold first interrupts and awaits them, so no child outlives a token it inherited.
  - A fiber forked into an outer scope (`forkIn`, daemon) inherits no tokens.
  - A check reads only tokens still held, so a stale rank never refuses. A parent waiting on a child cannot be waited on by it.
- An acquisition at a rank lower than or equal to one held refuses **in production as in tests**. It fails with the defect `lock-order`, naming both stacks, before it waits. An operation that would have deadlocked fails instead.
- Re-taking a key the fiber or an ancestor already holds refuses the same way: `Held` is not reentrant.
- Multi-key acquisition of one rank is allowed only as one sorted set taken at once (workspace directories, then files).

**Waits that are not locks.**
- **Joining a `Flight`**, and **waiting in a lane or queue served by someone else** (the commit lane, a pass's result). The waiter must hold no `Held` token and no execution ticket; otherwise the wait refuses. A residency lease — an entry lease or a memory charge (§3.4.4) — may be held, because nothing waits to acquire a lease.
- **Waiting for a pass to complete.** This is allowed only for a call that asked for that work (`sync_graph`, `run_doctor`, a performance read), under the rule above.
- **Worker and host asks** are external calls, bounded per §3.12.
- **Callbacks.**
  - Git runs through the platform git kit with hooks off, as Tagma's own git (`TAGMA_OWN_GIT`, [[e7729ae1]]). The kit refuses a git call with hooks enabled under any hold or ticket; that is F012's lesson as a check.
  - A callee that may call back into this server is called only while the caller holds no `Held` token and no ticket: a user hook run by the commit lane (§3.4.2), a tool call on an MCP server such as `tagma mcp-serve`, a harness CLI. MCP and web-search gates therefore cover only connecting (below), never the call.
  - The callee's own requests enter as new calls, with their own tickets.
  - A callback carries its **origin**: the external call that spawned it, through the session token of `tagma mcp-serve`, the hook environment, or the harness CLI. A callback that would join a `Flight`, or enter a lane, that its origin is **in or waiting on** refuses at once with `reentrant`, naming both, instead of completing a cycle (Astra S3-2, Opus B8). For example, a hook calling `submit_work` on its own checkout gets `reentrant` from the hook lane its origin occupies.

**Capacity comes as phase-scoped tickets.**
- An **execution ticket** (§3.4.4) is taken for one phase: one judgement ask, one heavy pass slice, one open. All the tickets of that phase are taken at once, all or nothing, before any `Held` token of the phase.
- It is released at the phase's end and on interruption. It is released before any wait on another party (a lane, a `Flight`, a pass) and before any callback-capable call.
- A landing therefore holds no heavy slot while it waits for the commit lane or runs user hooks. A `check_rules` a hook sends takes its own ticket.
- No holder of a token or ticket waits for a ticket another waiter holds, so capacity closes no cycle.
- **Residency** — an entry's lease and its memory charge — is separate from tickets. It is held for as long as the holding stands, and it is never waited on by a holder of a ticket.

**The graph.** Ranks are declared with gaps. The table is the initial declaration, from the inventory and the reviews' nesting reads. E0 measures the real nestings with refusal on in tests, and each owner corrects its ranks before its wave moves its sites onto `Held`.

| Rank | Resource | Owner | Holders (target) | Threshold | Waiters | External call under it |
|---|---|---|---|---|---|---|
| 50 | Execution tickets (§3.4.4) | `platform` | one phase of a call or a pass | the phase | same class, FIFO, with the §3.12 wait ceiling | none: released before callback-capable calls |
| 100 | Provisional branch lock | `worktrees` | naming a provisional branch, around its finishing act | 60 s | titled threads | through rank 120 |
| 110 | Pending-merge gate (per root) | `landing` | a **claim** only: reading and changing the root's queue row (admit, claim to `running`, settle, drop), never the merge itself | brief | the same root's requests, by try-acquire | none |
| 120 / 121 | Finishing gates: per root id, then per base path | `worktrees` — the root's finishing gate; landing's merge and PR and threads' `update_worktree` take it through worktrees' service; archive, restore and rename are worktrees' acts | a finishing act: merge, archive, restore, rename, PR | operator-paced; stall record past 60 s | the same root or base, by **try-admit** (§3.4.2) | **named:** git merge, `gh` (2 min, [[a1d4ed77]]); no callback |
| 130 | Worktree notes lock (per root) | `threads` — notes are written into each placed thread's journal with revisions, from worktree records, threads' target operations and landing's merge receipts | created, setup, moved and merged notes | brief | the same root | none |
| 210 / 211 / 212 | Web-search session → MCP pool passes (per project) → MCP per-server gate | `packages/agent-tools`, `packages/mcp` | **connecting only**: a reconcile, a session open, a per-server connect, each as a `Flight` joiners wait on. A tool call runs on the connected session with no gate: today's slow path holds the gate across the call (`packages/mcp/src/McpPool.ts:152`), which goes. | the connect timeout | the same session, project or server | **named:** network, stdio spawn. A stdio server may call back into Tagma while it starts (`packages/mcp/src/McpPool.ts:255-291`). Its session token carries the server's identity, and a call from that origin that would join that server's own connecting `Flight` refuses at once with `mcp-connecting`, instead of waiting on its own initialization. Tool calls, which may call back, hold nothing. |
| 220–223 | Token refresh gate (per account) → refresh lock file → credential writes → credential main lock | `packages/llm` | one refresh | the provider timeout; lock files bounded by `LockBusy` | the same account | **named:** network refresh, cross-process lock file |
| 230 | Execution client connect | `packages/executions` | one handshake | the connect timeout | the same client | **named:** host socket |
| 240 / 241 | Thread flush window, then snapshot lane | `packages/agent` (`native-harness`) | one flush; one publish | 250 ms | the same thread | none |
| 250 | Execution input and custody gate | `executions` | one input, port open or transfer | one host round trip | the same execution | **named:** host socket; no callback |
| 260 / 261 | Workspace directory locks, then file locks (sorted sets) | `packages/agent-tools` | one file operation | one file operation | the same paths | none |
| 280 | Hook section (per checkout), held by the **hook lane's** own fiber, never by the landing call | `platform` git kit (used by `landing`: landings, the archive's preservation commit, merges) | one landing's user hooks, one at a time, because hooks change the shared working tree and index — formatters, `lint-staged`'s stash (Opus B8) | the program default for hooks (§3.12) | other landings of the checkout, as lane entries they hold nothing in | **named:** user hooks, which may call back; a callback from this origin into this hook lane or the commit lane refuses `reentrant` |
| 290 | Commit section (per checkout), held by the **commit lane's** own fiber, never by the calling landing or P3 | `platform` git kit (used by `landing` and `graph` — P3, its own acts, without importing landing) | one publishing step, git plumbing only: ref check, `commit-tree`, `update-ref`, `index.settle` (§3.4.2); team-mode P3 publications; settlement-only steps | the step's ceiling (§3.12) | other steps of the checkout, as lane entries they hold nothing in | **named:** Tagma's own git with hooks off; no callback, no ticket, no judgement. Hooks and re-judging run outside the lane. |
| 295 | Accepted-law permit (per project, `enforcement/accepted-law`) | `enforcement` | acceptance; the last accepted-revision check and publication; a vocabulary activation through `AdoptedLaw.hold` | 1 s stall threshold; hold and wait bounded by `CEILINGS.callCap` and `CEILINGS.callWait` | the same project's acts, concurrency 1 | **named:** Tagma's own git with hooks off, the ref read and `update-ref`; no callback. Resolve the graph before entering the commit lane. A publication takes 290 then 295; activation takes 295 before graph/tree and writer ranks. No hooks, judgement, lane wait or re-entry under 295; GLOBAL and local projects use the same order. A cut leaves publication outcome to its durable witness and recovery, never proves rollback. |
| 300 | Checkout index section (per git dir) | `platform` git kit | index settlement after a landing or a team-mode P3 (§3.4.2) | ≤ 1 s | the same checkout's settlements | **named:** git, under git's own `index.lock` |
| 400 | Entry gate (per tree) | `graph` | open (store open, stamp check, watcher, or the first copy of §2.4.5 when the completion stamp is missing), retire, evict | open: the stamp check; first copy: recovery, shown as progress | resolves of the tree | **named:** shadow attach git |
| 410 | Repository permit (per shadow git dir) | `graph` | attach; topology sync after a HEAD move | ≤ 1 s + one sync | the repository's syncs | **named:** git in the shadow dir |
| 420 | Tree permit (per tree) | `graph` | **one act's P1 through P2** (§3.11); P3's batch capture and byte read; repair of the paths the watcher names | one act's rows and paths; stall record past 1 s | acts and repairs of the tree | none |
| 430 | Discharge look (per checkout) | `change-record` | one HEAD observation, as a pass | one HEAD move | none on the call path | **named:** git reads |
| 500 | Graph store writer | `platform` store | C1/C2 units: P1, drain settle, touch record, catalog activation | 250 ms stall threshold | units by class | none (§2.4.11 kit refusal; `Unit.run`) |
| 510 | Machine writer | `platform` store | machine units (§2.4.2) | 250 ms stall threshold | units by class | none |
| 600 | Inspection lanes `gate`, `merge`, `measure`, `reach` | `enforcement` | one ask per worker | the derived ask ceiling of §3.12: past it the ask is cancelled, answered "not judged: ceiling exceeded", and a stall record is written | the lane's FIFO, under the §3.12 lane-wait ceiling | worker thread; no callback |
| 610 | Checkout readings (3) | `workspace` | status and comparison readings | 30 s deadline (a read, designed to be cut) | surface reads | **named:** git status and diff |
| 690 | Brief in-memory gates (`CheckoutStatus`, `ThreadFiles`, `GraphFeed` publish, `AccountQuota`, `TerminalInventory`, `Sandboxes`, `McpServers`, `HarnessScreenAsks`, `HarnessMetadata`, auth sign-in, succession asking, `AgentPace`) | their owners (`ThreadFiles` change-record; `AccountQuota` and auth sign-in providers; `TerminalInventory` executions; `HarnessScreenAsks` and `HarnessMetadata` external-harnesses) | map management and brief reads | 250 ms | the same gate | as the inventory names; the ones that reach credential files or the host rank below them at E0 |
| 700 | Host wire slots | `packages/executions` | one verb | the verb's deadline | the connection | host socket |
| 710 | Reader pools | `platform` | declared reads | the §2.4.11 read deadline | the pool | none |

**Rules over the table.**

1. **No hold crosses git, network or a spawn unless the table names it,** and each named hold states its bound. Rank 420 loses both of its git holders:
   - the whole-tree freshness status goes, because the watcher names paths (§3.4.5);
   - `TreeCommits` goes, because P3 builds its commit outside the permit (§3.11). With it goes the edge tree → discharge (`TreeCommits.ts:156`).
2. **A clean `fresh()` takes no permit.**
   - The watcher advances an **observed epoch** with every event.
   - A repair records the **applied epoch** it covered and marks itself in flight.
   - A read is clean when applied ≥ observed and no repair is in flight. Such a read takes nothing.
   - Otherwise it joins the repair in flight covering its epoch (a `Flight`), or takes rank 420 to repair.
   - A moved HEAD takes rank 410 for its topology sync.
   - This replaces the boolean that `FreshnessGate.ts:137-158` clears before its asynchronous repair.
3. **Writers serve by a class-level weighted rotation.**
   - **Queues.** There are three FIFO queues: `call` (a call's own unit), `recovery` (intent drivers, act recovery, settle of what a call already committed) and `background` (passes).
   - **Two counters.** `r` counts the turns taken by `call` since `recovery` was last served, while `recovery` waits. `b` counts the turns taken by `call` or `recovery` since `background` was last served, while `background` waits.
   - **Each turn.** If `background` waits and `b ≥ 8`, the head of `background` is served. Otherwise, if `recovery` waits and `r ≥ 4`, the head of `recovery` is served. Otherwise the head of the highest non-empty class is served. A served class resets its counter.
   - **Guarantees under saturation.** `background` takes at least 1 turn in every 9. `recovery` takes at least 1 turn in every 5 of the turns not taken by `background`. `call` takes the rest, at least 32 of every 45 turns. A unit at position q in its class queue is served within about q × 9 turns (`background`) or q × 5 turns (`recovery`) of the turns the class shares.
   - This bounds shares of turns, not milliseconds. The time a call waits is bounded by §3.12's writer ceiling.
   - A background pass writes in slices and releases the writer between slices.
   - A call that joins a background flight raises the flight's remaining units to `call`. The wait before that is attributed to the background holder.
   - The rotation lives in `packages/sqlite-process`'s writer admission (`SqliteProcess.ts:99,113-120`).
4. **Writers never refuse by queue length.**
   - A unit past its hold threshold writes a stall record and goes on.
   - **Units that close an effect already committed** are class `recovery`, whoever calls them: a run's end, a delivery's take-back, an intent's settle, a landing's tail. They are never withdrawn from the queue. A call waiting on one past its ceiling answers `stalled { outcome: uncertain }`, and the unit stays queued and runs; its driver owns it (Opus §3.12-2).
   - **A call's own first unit, unstarted.** Past its wait ceiling it is withdrawn from the queue unstarted, and the call answers `stalled { outcome: none }`.
   - **A running unit past its ceiling (§3.12) is stopped by the only mechanism the child offers.** The statement runs synchronously in the SQLite child (`packages/sqlite-process/src/child.ts:18-72`), and the parent awaits its answer uninterruptibly (`connection.ts:210-225`; [[fa3df495]]). So stopping means killing that store's writer child.
     - **The permit stays fenced** until a new writer child has opened the file. WAL recovery discards an uncommitted transaction, and no next unit runs on a connection still executing the old statement.
     - **Before COMMIT was sent**, the kill proves a rollback. The unit answers `stalled { outcome: none }`.
     - **After COMMIT was sent**, nothing is proved. The unit answers `stalled { outcome: uncertain, key }`, and its owner re-reads its key after the reopen — the act id, the intent key or the call id — to settle what happened, before anything is retried.
     - The cost is one writer restart for that store: a new process and an open, tens of milliseconds, with its readers unaffected. It is counted.
     - `sqlite3_interrupt` from a second thread of the child would be cheaper. It is not available through `bun:sqlite` today, and is left to E0 to measure (Astra S3-13).
   - **Large units.** Section 2 allows units whose size follows their data: a fork's history copy, a rest's batches of 8,000 rows / 32 MiB. These are declared `large`, whatever their caller's class.
     - A large unit is queued in `background`, so it progresses under the rotation's guarantee (1 turn in 9) even under a constant stream of calls. It still starts early on any turn where no `call` unit waits.
     - Its turn counts as one turn but holds the writer for its whole run. That duration is named, counted and measured in D9.
     - A call whose own unit is large — a fork — waits for it as for its own work, under the ceiling for large units in §3.12.
5. **Every read is declared.** An undeclared read that reaches the writer counts as a defect of its module. The fallback onto the writer after a failed pool take stays for liveness, counted with its cause.

**Watcher API.** Owner: `workspace`, from `working/TreeWatch.ts`; the filesystem watch primitive under it is a platform kit, and graph and change-record subscribe to workspace's events ([[f658e190]]). The watcher reports one of two events:
- `{ paths }` — known changed paths. A rename reports both paths when it knows them, and the parent subtree otherwise.
- `{ rescan: reason }` — an event with no file name (dropped today, `TreeWatch.ts:73-77`), queue overflow, watch loss, or the baseline at open and after a restart.

A rescan is recovery: a status read over the tree's graph paths, taken as a pass and shown with its cost. A tree whose watch cannot be granted (§3.4.4) is **polling**: each read's freshness is a rescan. Its cost is stated on the tree.

### 3.4.2 What a tool call waits for

**It waits for its own work.**
- Its own units at the writers, class `call`, with the contention of rule 3.
- Its own graph act's P1–P2 under rank 420. It queues behind the acts ahead of it on that tree, each one act's P1+P2, never their P3.
- Its own checks at gate: before-triggers and landing judgement, on the `gate` lane.
- Its turn in the checkout's commit lane. Each landing ahead costs one plumbing step: ref check, `commit-tree`, `update-ref`, index settlement. Hooks and judgements run outside the lane. That is contention for the checkout's HEAD, which only one commit can move at a time. The caller waits holding nothing; it does not wait for the other landing's build or judgement.
- The freshness of what it reads: a repair of named paths, a topology sync, or a cold open of its graph.
- Resources it shares by identity: ranks 210–261.
- The external party it asked: the model, the host, git for its own commit and hooks, an MCP server.
- Work it asked for explicitly: `sync_graph` for landings, `run_doctor` for its sweep, performance reads for their report.

**It never waits for another agent's scenario to complete:** a landing, a merge, a judgement, P3, a re-measure, a drain or doctor pass, an export, rest or wake, a discharge look, eviction or reclaim, a telemetry flush, or a background worker's warm-up.

**After-edit checks enqueue and return.**
- `checkRule` calls `Remeasures.checked` synchronously for every edit and write in the checkout, with no lookup. The `wanted` wait (`checks.ts:228-235`) and its 60 s index go.
- The `measure` pass decides whether any after-trigger applies.
- The trigger projection is **enforcement's own**, kept in memory. It is keyed by the graph store's identity (checkout root, store generation) and by the store's `law_revision`, GLOBAL's `law_revision` and `vocabulary_revision`. The pass rebuilds it when a key moves.
- No graph act writes it. Graph publishes revisions in `graph_stamp` and signals them after commit (C3).
- A graph the pass cannot open is retried with backoff and stays visible; it is never read as "no triggers".
- On restart the queue is empty. An edit's notice that was queued and not yet judged is lost with the process. The next edit or landing of that thread judges the file again; this limitation is stated in [[74e2e9a6]]'s rewrite.

**The touch.**
- The touch record is a row-only C1 unit on the graph writer, without rank 420. §2.4.8 already declares touch records row-only.
- The touch brief is a read.
- The edit window comes from the text the edit tool already holds, so `touchRule.ts:69`'s `readFileSync` goes.

**Landings run in parallel up to the gate lane's workers.**
- The `gate` lane runs one worker per heavy slot available to calls (§3.4.4): H − 1 on the lowest class, which is 2. Past that, judgements wait in the lane's FIFO. They never wait behind a background ask or a per-checkout gate. The per-root gate of `submitWork.ts:27-31` goes.
- **Today's commit is not a compare-and-set against the judged base** (Opus B7, Astra S3-4).
  - `git commit` under `GIT_INDEX_FILE` takes the HEAD git reads at that moment as parent, and the tree of an index built on the older base. If another commit landed in between, the new commit publishes a tree without that commit's changes, erasing it in the branch.
  - `submitWork.ts:487-520` notices only after publication (`parent !== base`) and undoes with `update-ref HEAD parent tip`. That undo loses if anything committed on top, and it is skipped on the last attempt, so the erasing commit stays with `builtBefore`.
  - Today the per-root gate keeps Tagma's own landings from racing. Removing it without a real compare-and-set would make the erasure routine.
- **Each landing** (v4 — Opus R1/R2, Astra S3-2/S3-4):
  1. writes a durable `landing` intent (`landing`, machine store): job id, checkout, the judged base, built tree, paths, attribution digest, state `building`;
  2. builds through change-record's prepared change, a scoped lease that keeps the tree until the judgement has read it ([[f658e190]]), **in parallel** with other landings;
  3. judges **in parallel**, on the `gate` lane, with its own tickets;
  4. runs the user's commit hooks through the checkout's **hook lane**, one landing at a time, holding nothing while it waits, through `git hook run`. The hook lane is separate from the commit lane, and its wait counts against the landing's 15-minute deadline:
     - `pre-commit` against its private index (`GIT_INDEX_FILE`), as `git commit` would. If the hook changed that index, the tree is written again and the changed paths are re-judged, still in parallel.
     - `prepare-commit-msg` and `commit-msg` on the message, which carries the trailer `Landing: <job id>`.
     - Because hooks run outside any hold, a hook that calls back — `check_rules`, even `submit_work` on the same checkout — enters as a new call with its own admission, and nothing it waits for is held by its caller.
  5. enters the checkout's **commit lane**, holding nothing. The wait has §3.12's call-class ceiling.
- **The commit lane** is a single worker per checkout. Its mechanism, like the hook lane's, belongs to the `platform` git kit and is built in E0, so `graph` (P3) and `landing` (landings, preservation commits) both use it without an upward import (Astra 3). Receipts and scenarios stay with their owners. Each entry hands the lane a bound pair: `(ref, prepared base, tree)`. The step holds only the commit section (rank 290), which admits no callback, no ticket and no judgement, and runs **git plumbing only**, with hooks off:
  1. **Read the symbolic ref and its sha** (`symbolic-ref -q HEAD`, then `rev-parse`), and refuse a foreign operation in progress (merge, cherry-pick, rebase, bisect), as `notMidOperation` does today. The ref — `refs/heads/<b>`, or `HEAD` when detached — is written into the intent.
  2. **If the ref is not the one judged, or its sha is not the judged base,** the landing **leaves the lane**. Outside it, the landing:
     - rebuilds on the new sha from its attribution;
     - reconciles certificates (below);
     - re-judges what they do not cover, in parallel, with tickets;
     - runs the hooks again on the rebuilt index, through the hook lane.

     It then re-enters the lane **at its original position**: among ready entries the lane serves by first arrival, so an exiting landing does not fall behind later ones. Each exit is one attempt, bounded by `ATTEMPTS` and by §3.12's total deadline. Inside the lane nothing is judged, so no landing waits there for another's judgement.
  3. **Build the commit object** with `commit-tree <tree> -p <sha>`: one explicit parent, so it can never conclude a foreign merge. Write the commit id and the ref into the intent durably, state `publishing`. This is the **candidate witness**.
  4. **Publish** with `update-ref -m "tagma landing <job id>" --create-reflog <ref> <commit> <sha>`: a true compare-and-set on the recorded ref, which also writes a reflog entry naming the job. That entry is the **publication receipt**.
     - Before publishing, the step re-reads `symbolic-ref`. If HEAD now points elsewhere — a branch switch or a detach, even to the same sha — this is an outside operation, and the landing returns to step 1.
     - A lost compare-and-set means a commit made outside Tagma landed after step 1. The landing leaves the lane as in step 2.
  5. **Settle the index** for the landed paths (`index.settle`, below), inside the same step. No Tagma publication of this checkout can then move the ref between the guard read and the index write.
  6. **Release the section** and set the intent `committed`. The landing then runs `post-commit` with no hold, and answers.
- **Team-mode P3** publishes through the same commit lane, with no hooks, **including step 2** (Astra 3). Its entry carries the head it prepared on. A ref moved past that head sends P3 out of the lane to rebuild, by §3.11's intersection rule, before it re-enters. Tagma's two publishers of one checkout therefore never race, and a landing's lost compare-and-set is never caused by Tagma's own P3.
- **Git version.** `git hook run` needs git 2.36 or later. On an older git, `submit_work` refuses before anything is published — `git-too-old`, naming the version found and the version required. v3's fallback to `git commit` is withdrawn: it could publish a tree without an intervening commit's changes (Astra S3-4).
- **Judgement certificates** reuse builtin verdicts when a rebuilt tree is judged again.
  - Today `Inspected.read` merges both sides into one list of the paths that were read (`enforcement/inspecting.ts:129-153,182-191`). The `has` and `paths` calls of the recorded tree are not captured (`:113-123`). The verdict is built minus base minus debt (`apps/tagma/inspection/src/node/judge.ts:29-36`), so a base change alone can turn a standing crossing into a new one.
  - Evidence capture is therefore extended, **per side, base and built**:
    - each read path with its blob id;
    - each `has` query with its answer, including **negative** answers;
    - each directory listing with its digest.
  - A certificate also holds:
    - the subject selection;
    - the rule document's digest: inspection, parameters, reach and debt. `enforce_rule` writes that document through a graph act, which also bumps `law_revision` (§3.4.5).
    - the inspection implementation's version;
    - the store's law and vocabulary revisions;
    - the attribution digest.
  - A verdict is reused only when every item matches on both the new base and the new built tree. A builtin that does not capture complete evidence re-judges. Program inspections always re-run. Before-triggers and after-triggers run as for any landing.
- **Outcomes, with an exact boundary.**
  - **Nothing is published until step 4's `update-ref` is sent.** A landing that exhausts `ATTEMPTS`, or crosses a ceiling before step 4, answers `stalled { outcome: none }` and settles its intent `abandoned`. If hooks already ran, the answer names them, since hooks may have touched the working tree. Tagma itself made no commit.
  - **Once `update-ref` has been sent,** the outcome is read, never assumed. A landing whose `update-ref` answer does not arrive within its ceiling has that git process stopped. The outcome is then established from the recorded ref and its reflog, as below:
    - `committed`: it answers `landed`;
    - not published: it answers `stalled { outcome: none }`;
    - undetermined: it answers `stalled { outcome: uncertain, job }`.
  - **After a successful publication, the landing is `landed`.** Anything unfinished is its tail.
- **Recovery by receipt.** A `publishing` intent is resolved at boot, against the **recorded ref**, never against whatever HEAD is now:
  - the commit is reachable from the recorded ref, or the ref's reflog holds this job's entry → **`committed`**. If the commit is no longer on the ref, it is `committed` with a finding that the branch was rewritten since;
  - no positive proof → **`uncertain`**. A missing reflog entry proves nothing (Astra 1): expiry, deletion or rewrite can remove one entry and leave older ones. The landing is shown to the thread and in `sync_graph`, and never turned into `abandoned` or published again automatically. The safe resolution is to run `submit_work` again. If the commit did land, the new landing finds nothing left to land and answers `nothing`.

  **`abandoned` is proved only by order.** `update-ref` is sent only after the `publishing` witness is durable. A `building` intent, or one that never reached `publishing`, cannot have published, and is `abandoned`.
- **The tail.** Index settlement runs inside the publishing step. The rest runs in commit order per checkout, until `settled`:
  - the change-record stamp;
  - discharge;
  - after-triggers.

  A tail whose index settlement did not finish — a crash, or a busy lock after its retries — re-enters the commit lane as a settlement-only step. The driver runs at boot and on cadence ([[a00f91b0]]).

**Index settlement** is the `platform` git kit's `index.settle(checkout, ref, entries)`. It is called only inside the commit lane's step, by landings and by team-mode P3. Each entry names `(path, base blob, landed blob, commit)`.

The kit takes git's own `index.lock` exclusively (create-exclusive, as git does), copies the current index into a temp, and decides each path against the temp and against the **recorded ref now**:
- HEAD still points at the recorded ref, the ref's blob at the path is the landed blob, and the index entry is the base blob → the entry becomes the landed blob;
- the ref's blob differs from the landed blob → **`superseded`**: a later commit owns the path, and this settlement leaves it;
- HEAD points elsewhere, or the entry is anything else → **`unsynced`**: the user switched branches or staged something, and the entry stays.

It then writes the temp into `index.lock`, renames `index.lock` over `index`, and **then** reads the ref again.
- **The version guard.**
  - Tagma's own publications of the checkout cannot move the ref during the step, because they run in the same lane. A user's `git commit` meets `index.lock`.
  - An outside `update-ref` takes no index lock, and nothing Tagma can hold stops it (Astra 2). No re-read before the rename can close that window. So the outcome is decided **after** the atomic rename:
    - ref unchanged since the guard read → the paths are `synced`;
    - moved → they are `unsynced`, with a finding. The index then holds entries for the head the settlement read, which is exactly git's own state after any `update-ref` that does not touch the index.
  - A settlement is never recorded `synced` over a ref that moved before its rename.
- A foreign stage cannot slip in between, because every git command meets the lock.
- A busy lock is retried with backoff, as `SYNC_TRIES` does today, under the step's ceiling.
- Outcomes per path are recorded on the intent.

**Merges try-admit and never wait for another merge.**
- **The pending gate covers a short claim, never the merge.** Today `PendingMerges.merge` holds it through the whole merge (`working/PendingMerges.ts:64-66,145-168`). In the target, `merge_worktree` **try-acquires** the root's pending gate (110) and reads the row under it:
  - a row `running` for this root answers the existing `WorktreeMergeQueued` for it, or `merge-running` without `queue`;
  - otherwise it claims the row as `running`, writing the **request witness** (below), and releases the gate. The merge then runs under the finishing gates only.
  - Settling or dropping the row takes the pending gate again, briefly.
- The merge **tries** the finishing gates (120/121) without waiting.
- If a finishing act of the same root or base holds them:
  - **with `queue`**, the merge is stored as today's `worktree_pending_merge` row with the new reason `base-merging` (added to `BASE_BUSY`), and it answers the existing `WorktreeMergeQueued`;
  - **without `queue`**, it refuses `base-merging` at once, with `unblock` naming `queue`.
- No new answer arm appears at any door.
- The row gains:
  - `request_id` — the call id, stable across retries;
  - the requesting thread;
  - `state: waiting | running | stopped | settled`;
  - `outcome`;
  - `noticed_at`.
- The queue is per base, in `queued_at` order. The position is computed on read.
- The retry watcher becomes a declared pass (`landing`, recovery class), driven at boot from standing rows. `landing` declares `MergeNotice`; the merge receipt is the durable source of the merged note, and the after-act's order and refusal stay as [[82d903dd]] ([[f658e190]]).
- **Archive** ([[f658e190]]): archive holds the finishing gate and writes its **archive intent** (worktrees; one row per call) before any effect. The preservation commit runs through landing on the commit lane with landing's own intent, witness and receipt under the landing protocol, keyed by the intent's receipt key. Recovery resolves the publication by that key first — present, absent, or unresolved and waiting on landing's own recovery — and never re-commits on a phase name; it then finishes removal, the settlement unit (which drops the pending merge) and the placed threads per thread under the original caller's authority, recording each outcome on the intent.
- **The request witness** is written in the claiming unit, before any git effect. It holds:
  - the base ref and its sha;
  - the source ref and its tip sha;
  - the mode.

  Execution and every retry use the **recorded source sha**, never the branch name resolved again. Today's retry re-reads the tip (`PendingMerges.ts:155-168`, `WorktreeFinishing.ts:366`), which would take later commits of the branch; that changes with this contract.
- **Phases, each recorded before it acts** (Astra S3-12):
  1. **`built`.** Where the mode builds its result before moving any ref — the rebase replay (`WorktreeFinishing.ts:538-545`), and a squash or merge built on a private index — the result commit and its tree are written to the row first. A merge done in the base's working tree carries the trailer `Merge: <request_id>`.
  2. **`base-moved`.** The base ref moves by `update-ref <base> <result> <witness base sha>` (`:546` today), with a reflog message naming the request.
  3. **`source-moved`.** For `rebase`, the source ref moves the same way (`:547`).
  4. **`worktree-settled`**, then the after-merge acts.
- **After a crash, the driver resolves each phase from the refs and their reflogs against the recorded values** — never from patch ids, which also match an independent cherry-pick:
  - a ref at its recorded result, or a reflog entry naming the request → that phase is done, and the next phase runs;
  - a phase never recorded → it was never acted on, since each phase is recorded before it acts, and it runs, with the recorded source sha;
  - a recorded phase whose refs still stand at their witness values, with no positive proof → **`uncertain`**, as for landings. A missing reflog entry proves nothing (Astra 1). The ref may have moved and come back.
  - a ref moved to anything else, without the request's entry → **`uncertain`**. The row stops, the thread is told through `MergeNotice`, and nothing is repeated automatically.

  A request is `merged` only when all its phases are done.
- A settled or stopped merge is told to the requesting thread through the port **`MergeNotice`**.
  - `landing` declares the port ([[f658e190]]); `threads` implements it by appending to the thread's inbox; `composition` starts it before admission (§1.4 rule 9).
  - The port is taken in the same machine unit that settles the row (C2b).
  - A thread that no longer stands drops the notice with a note on the row.
- `cancel` removes a `waiting` row. On a `running` row it refuses `merge-running`: the merge is in git's hands and settles by itself.
- A restart forgets neither the accepted merge nor the promised notice.

**`busy` is only an entry answer.**
- It exists at the landing's start, the merge's admission, a graph open, and a heavy slot for an explicit `check_rules` or aimed `run_doctor`.
- **`busy` is an admission refusal.** It is given before the call queues for anything, when the expected wait — the queue ahead × the resource's recent p50 hold — is over 60 s. Nothing has started.
- **`stalled` is the answer to a wait that was admitted and then crossed its ceiling** (§3.12). It is a defect, with a stall record, and it carries `outcome`:
  - `none` when it is proved that nothing took effect: an unstarted unit, a landing before `update-ref` was sent, a cancelled ask;
  - `uncertain`, with the key its owner resolves the outcome by, when an effect may have happened: a COMMIT or `update-ref` sent without an answer.
- After P1, a published landing, a claimed merge or any other committed effect, neither answer claims "nothing happened". The act's driver completes or resolves it, and the answer says it is pending.

### 3.4.3 Background work

**`Passes`.** Each module declares its passes in its manifest:
- `name`;
- `key` (one run per key; a trigger during a run earns one more);
- `triggers` (boot, event, cadence, intent standing);
- `class` (`recovery` or `background`);
- `cost` (`light`, `heavy`, `writer` in slices, `large`);
- `slice`;
- `cancel` (at slice boundaries);
- **`source`**: `durable` (the work is re-derived at boot from named durable state) or `advisory` (lost on restart; the loss is stated).

`composition` hands passes to the scheduler, and a pass without a trigger fails the build ([[a00f91b0]]). An idle key is deleted after its run. A durable-sourced pass pages its backlog from its store per [[68659e3b]], so memory holds one page, not the backlog.

| Pass | Owner | Class | Source | Trigger |
|---|---|---|---|---|
| graph act recovery and P3 sync | `graph` | recovery | `graph_act` phases | boot, act commit, policy timer |
| measure drain | `graph` | background | `measure_pending` | marks committed |
| freshness repair; rescan | `graph` | background (a reader needing it joins as its own freshness) | watcher epochs; rescan on baseline | watcher |
| topology sync | `graph` | background | HEAD watcher | HEAD move |
| entry eviction | `graph` | background | advisory | ledger pressure, idle cadence |
| catalog request driver | `graph` | recovery | `catalog_request` pending | boot, request |
| after-edit checks | `enforcement` | background, `measure` lane | advisory (§3.4.2) | edit |
| re-measure | `enforcement` | background, `measure` lane | `enforcement/remeasured.json` and landings | landing, enforce |
| commit queue drain | `enforcement` | background | the commit-queue file | admit, boot |
| landing tails | `landing` | recovery | `landing` intents | boot, commit |
| merge queue | `landing` | recovery | `worktree_pending_merge` | boot, base movement, 2 min |
| discharge look | `change-record` | background | HEAD watcher | HEAD move |
| export, rest, wake | `threads` — one lane per thread for every thread, with native-harness's folds as a participant | background (a wake is the caller's own) | §2.4.7 watermarks | commit, rest policy |
| worktree notes | `threads` | background | worktree records, threads' target operations, merge receipts | worktree-moved and merge-settled events, the target change, boot |
| archive recovery | `worktrees` | background | archive intents not done | boot, cadence; after landing's receipt recovery |
| registry dump | `installation` | background | registry rows | change event |
| intent drivers | their owners | recovery | intent rows | boot, intent |
| terminal disposition | `executions` | background | host inventory | cadence |
| CLI metadata watch | `external-harnesses` | background | session files | cadence |
| shelves, reclaim, vacuum, WAL checkpoint, snapshot cleanup | `platform` / `installation` | background; the floor path is recovery | §2.4.11 | cadence, floor |
| performance maintain, trace retention | `performance` | background, lowest | its store | cadence |

**Admission and reserve.**
- A pass takes capacity before any lock.
- `recovery` has a reserve that neither calls nor `background` may take: one heavy slot, the writer's recovery class, and a memory share (§3.4.4). It may also use the general pool.
- A pass never uses the `gate` lane.
- A pass failing repeatedly backs off and stays visible with its cause. Nothing is lost silently.

**Visible state.** Each key's standing count, its oldest trigger's age, and its last run's duration and outcome.

**Admission leases** ([[f658e190]]). The `Harness.quiet` lease is an admission lease: acquired atomically with the check that no run or session stands, released on every outcome, refusing when quiet cannot be proved; `begin`, `continue`, adoption and answer-resume take it. It never pauses an external CLI. Resource leases (the prepared change, a guest read) take it under their own ceilings.

**After-edit** ([[f658e190]]). A native world tool's edit enters the trigger dispatcher through `ThreadExecution.afterEdit`; enforcement's after-trigger enqueues on the measure lane and the tool does not wait for the judgement; the guarantee of [[74e2e9a6]] keeps its producer.

### 3.4.4 Bounds

**One Tagma memory budget.** `platform` owns the `Capacity` ledger and the formulas; installation reads the machine and volume figures and the operator's settings at boot; each resource owner declares its envelopes, waits and cut semantics; composition hands the values ([[f658e190]]). The budget covers the server, its SQLite children and its workers:

M = min(0.5 × RAM, RAM − max(4 GiB, 0.25 × RAM))

- The 0.5 is today's restart share.
- The floor keeps room for the OS, the execution host and the agents' own builds and tests.
- On the lowest class, M = 4 GiB.

**The model counts each process once** (Astra S3-6). Workers (`new Worker`, `enforcement/Inspections.ts:60`) live inside the server process, so their heaps and native memory are part of the server's committed memory and are never counted again.

**This rests on a fact E0 must measure** (Opus). The server's committed memory is read from `bun:jsc`'s `memoryUsage()` (`packages/performance/src/ProcessVitals.ts:1,33,39`). Whether that figure covers the JSC heaps of worker isolates is not shown by the code. E0 compares it with the process's `phys_footprint` / RSS under worker load. If it does not cover them, the server's measure becomes the process RSS (`phys_footprint` on macOS), and the 0.6 split applies to that.

**Measured: the server process as a whole, plus each child process.** The children are the SQLite writers and readers of every store. `ProcessVitals` samples the server's commit and each child's RSS every 5 s.

**Reserved at admission: envelopes.** Each holding declares an envelope, charged before it allocates:
- a store's children: the per-process baseline measured at boot, when the machine store's own children start, times the processes it opens, plus its configured `cache_size` and `mmap_size`, which SQLite itself bounds;
- a worker: its declared heap limit, where the runtime enforces one (`resourceLimits`), or else its measured high-water mark on this machine, with a margin;
- a fold or serialization job: its declared input bound. A job over the bound streams, or refuses before it starts.

**Split.**
- The server's reservations, workers and jobs included, are held within **0.6 × M**. The restart ceiling moves from 0.5 × RAM to that figure (`main.ts:68`).
- Children's envelopes are held within the rest, less a **recovery share** of 0.1 × M.

**What is hard and what is soft.** Admission against envelopes is hard: a holding whose envelope does not fit is refused or queued before it allocates. Growth beyond an envelope is **soft accounting**, found at the next sample, not prevented. When it is found:
1. admission stops;
2. idle entries are evicted;
3. the holding that outgrew its envelope is recorded with a stall record naming its owner, and its envelope grows to the measure;
4. if the server's commit still crosses its ceiling, today's restart onto the installation runs (`main.ts:134-145`), which is recovery by design.

Nothing here claims that a 5 s sample prevents an allocation.

**Figures.** P = `os.availableParallelism()`.

| Resource | Figure | Lowest class | At the ceiling |
|---|---|---|---|
| Heavy slots (execution tickets): an inspection ask, Tagma's own git processes for passes, fold work | H = max(1, P − 1) | 3 | one slot is the recovery reserve. Calls take tickets from H − 1 (at least 1), and background may use at most max(1, H − 2) of them. With H = 1, recovery shares the one slot and preempts at slice boundaries. Tickets are per phase (§3.4.1). |
| `gate` lane workers | = the heavy slots calls may use | 2 | FIFO at the lane, under the §3.12 lane-wait ceiling |
| Children's envelopes | 0.3 × M less their current charges; the recovery share is 0.1 × M | 1.2 GiB | idle entries are evicted, least recently used first; with none idle, an open queues, refusing `busy` past 60 s expected wait |
| Server reservations | 0.6 × M less its measured baseline commit | 2.4 GiB total | a worker or job that does not fit waits for its ticket, refusing `busy` past 60 s expected wait |
| Readers per store | min(4, H + 1), lazy, exiting after 60 s idle, each charged | 4 | the pool FIFO, under the read deadline |
| File handles | 0.8 × `RLIMIT_NOFILE` soft, after raising soft to min(hard, 65 536) at boot; Linux inotify watches against `max_user_watches` | per OS | an ungranted watch makes the tree **polling**; an ungranted open queues |
| Compute tools per model step | S = max(2, P). Tools declare `compute` or `wait`; `wait_terminal`, a report wait and a network fetch are `wait` and take no S slot | 4 | queue inside the step, shown as `queued` |
| P3 in-memory batch bytes | min(64 MiB, M / 64) | 64 MiB | a batch's closure over the budget spills its captured bytes to a private copy (§3.11); it is never cut inside a closure |

**Leases and eviction.**
- **A lease is per call** (Opus). A call holds one on its entry for the call's scope; a feed subscriber holds one while subscribed; a pass holds one while it runs.
- **A running thread holds none.** Its tool context keeps the project's identity and resolves the served entry again at each call. Today the context holds the graph for the whole run (`touchRule.ts:125`, `composeAgent.ts:171`), which would pin the entry for hours.
- Re-resolving a warm entry is a map read, and a cold one is an open.

Eviction takes the entry gate and skips an entry that has:
- a lease;
- acts in `committed`, `projected` or `unpublished`;
- a drain mark;
- a repair in flight.

It cancels the entry's passes at a slice boundary before it closes. A `conflicted` act does not pin its entry; it reopens with it.

**Twenty agents are not refused for being twenty.** Admission bounds what they cost at once (Astra §2.5).

### 3.4.5 Cost locality

Structures are kept by the producer of the fact, in the unit that changes it ([[2393aff1]]).

| Read | Today | Target | Kept by |
|---|---|---|---|
| Regions of a place | all dir and file sources, then all parents | index `source(ref, kind)`; the place's d ancestors looked up in one `IN`; parents climbed by one recursive CTE | `graph` migration |
| Law forest | every law row per touch or step | recomputed only when its key moves: store identity, store `law_revision`, GLOBAL `law_revision`, `vocabulary_revision` (role bindings follow the vocabulary, `Orientation.ts:286-302`) | `graph`: the act unit that writes a law-role block, its container, scope, fields or enforcement document bumps `law_revision`. That includes `enforce_rule`, which writes the enforcement document through a graph act, so debt and strictness changes move it too. |
| Instructions per step | recomputed every `beforeStep` | compared by (store identity and root, the three revisions, audience, scope) against the **current context's** delivered key | `graph` (revisions); `native-harness` (delivered key); an external harness keeps its own delivered ledger for hook briefs |
| Delivered tags and law in a touch | scan of every model message per call | the delivered key of the current context | `native-harness` |
| Descendants | one query per node | one recursive CTE | `graph` |
| Frontier line | `rows.find` per ready task | a map by id | `graph` |
| Doctor territory | every block of the affected projects | the affected closure: sources under the old and new prefixes (a range scan on `source(ref, kind)`), their containers by CTE, and their reverse consumers | `graph` |
| Freshness | whole-tree `git status` on a dirty mark | the watcher's named paths; rescan as recovery (§3.4.1) | `graph`, `workspace` |
| Trigger set | 60 s TTL; graph open on miss | the `measure` pass's projection (§3.4.2) | `enforcement` |
| Thread list summary | computed per publish | `heldChanged(threadId)`, with the count read on read | `change-record` |

**The delivered key belongs to the current model context.**
- `native-harness` keeps `(context epoch, delivered key)`; an external harness keeps its own delivered ledger for hook briefs ([[f658e190]]).
- The context epoch moves at every compaction, fork or context rebuild — whatever changes which messages the model will see.
- An epoch mismatch recomputes the key from the messages, today's path (`instructionDelivery.ts:6-19`).
- Law the new context no longer carries is delivered again, never suppressed by an older delivery.

**What stays large, and says so:**
- a first copy or a rebuild after corruption;
- an unaimed `run_doctor`;
- a whole-reach inspection;
- a territory change whose affected closure is large.

Each runs as a pass or as the operator's act, with progress. Cost is judged against the affected set and the output, not against zero growth.

### 3.4.6 Event loop

**Rule.** No synchronous `fs`, `child_process` or `Bun.spawnSync` call runs on the **serving isolate** after admission.
- The serving isolate is the server process's main thread: code reachable from the serving entry.
- Code reachable only from worker entries (`*.worker.ts`, `StoreWorker.ts`), the SQLite child and the execution host is outside the rule.
- Boot work before admission lives in declared boot modules (`composition/boot/`), which the rule lists.

**Where the work goes instead:**
- async `fs`;
- the section 2 kit for durable writes, so `CommitQueue`'s append becomes a kit `append`;
- workers holding heavy slots for CPU over large data: schema decoding of large payloads, folds, rollout parsing and compression, whole-project renders, serialization of large answers;
- async spawns (`dockerSuite.ts:7` included).

**D9 attributes before it decides.**
- `LoopStalls` records every stall over 100 ms with its span.
- Loop lag and utilization are metrics.
- CPU profiles taken under D9's mixed load are attributed by owner module and span.
- **Loop utilization above 0.5 sustained, or lag p99 above 50 ms, opens an investigation, not a move.** These are the levels at which the loop measurably adds to every crossing and leaves under half its time for bursts.
- Each owner whose CPU dominates fixes its own cost first: serialization to workers, preparation, GC pressure.
- Only a measured dominance of thread turn work opens the decision to run turn loops in workers. That decision must keep storage-port transactions, cancellation and resource ownership, and must count the workers' SQLite connections and memory in the ledger.

### 3.4.7 One server per data directory

**Decided: one server process owns a data directory.** Its process-local queues and gate maps are correct because it is the only owner.

**The OS lock.**
- The server takes an exclusive advisory lock on `<data>/server.lock` before opening any store:
  - `flock(LOCK_EX|LOCK_NB)` on macOS and Linux;
  - `LockFileEx` on Windows;
  - through the platform FFI.
- The lock file is created once and never unlinked or replaced, so its identity is stable.
- Its handle is opened close-on-exec and never passed to children.
- The kernel releases it at death, which ends the stale-pid race and pid reuse.
- The pid is still written into the file, for display and `claimHolder`.

**Every opener.**
- `tagma db restore-snapshot`, `tagma db migrate` and fixtures on a real directory take the lock.
- `tagma op` and every CLI read talk to the running server and never open its stores.

**Succession keeps its handshake** (`http/succession.ts:167,179-184`):
1. the successor starts and answers `STANDING_BY` before it asks for the lock;
2. the predecessor leaves;
3. the successor then waits for the lock, polling `LOCK_NB` off the loop, and opens stores only once it holds it.

**The mixed-version fence.** A legacy binary takes no OS lock, so it could still race over a stale pid file. The release that introduces the lock also moves the machine chain: E0 lands with D0's credential migration. An older binary refuses to open a store whose chain is newer ([[bc4abc66]]), and graph stores refuse by their format marker (§2.4.5). A legacy starter that wins the pid race is refused at its first store open, before it touches anything. Older binaries are not supported as openers after that release.

**Rejected: several server processes sharing a directory** (Fable §6.3). There is no measured need. The loop is answered by §3.4.6 first, and shared ownership would turn every local queue into a fenced distributed lease.

### 3.4.8 Observability

**`Held` metrics.** Every `Held` resource emits wait and hold histograms, queue-length gauges and utilization, by resource, owner, class and holder kind. These are in-process aggregates, not span readings.

**The metric record contract** (`performance`) is extended beyond today's span-duration histograms and failure counters (`MetricSnapshots.ts:20-68`). A snapshot carries:
- histograms, gauges and counters with declared dimensions;
- the process instance and a reset epoch;
- **open holds** with their age, so a hold still running at snapshot time is seen, not missed.

A report distinguishes a missing snapshot, a process restart and a reset.

**Stall records.** A hold past its threshold, a wait past ten times it, a lock-order refusal, or a loop stall writes a stall record. It carries the holder, the waiters, the held ranks and stacks, the operation or pass, and the external call in flight. Stall records use a protected pending class: they are dropped after spans and metrics, and their loss is counted apart.

**Completeness (F081).**
- Percentiles come from metric histograms: the population.
- A figure from retained spans is labelled a **retained sample**, biased toward slow, failed and stalled spans, with its coverage: sampled, retained, dropped by overload and total, per window. Intended sampling and overload loss are separate denominators.
- A window without snapshots reads **unmeasured**, never zero.
- Losses are split into this process's and inherited.

**Writer attribution.** `sqlite-process` tags each statement with the holding permit's token, and `Store` attributes by token. The settlement window then closes on the statement that releases the permit, not after it. This removes [[291cc685]]'s limitation. Opkind labels become the store, owner and coordinator of §2.10 q17.

**Per call.** The thread's run trace carries each tool call's waits by resource, class and holder kind. `read_thread` can show that an agent waited on its own unit and not on another agent's landing.

**Where it is read.**
- The ledger's figures and use, queues, passes and polling trees are server diagnostics, read through `read_performance` and the status bar.
- `read_host_performance` stays the host's.

### 3.4.9 How it is held

| Rule | Check | Kind |
|---|---|---|
| Only `Held` makes exclusive resources | runlith rule **`held-resources`**, gate. It detects `Semaphore.make*`, `Effect.makeSemaphore`, and `Map`s of semaphores or `Deferred`s keyed by identity. A `Deferred` used as a one-shot result is not an exclusive resource and is not flagged. Single-flight booleans are not statically decidable and are not claimed: `Flight` is offered, and review catches the rest. Debt is recorded by the rule's first run, owned by each module's wave task. | static program |
| One lock order, by refusal | `Held`, in production and tests | runtime |
| No git, network or spawn under an unnamed hold; no hooks under any hold | the platform `Git`, spawn and fetch wrappers check the fiber's holds | runtime |
| No I/O in a unit | section 2's kit refusal and `Unit.run` | runtime |
| No synchronous I/O on the serving isolate | runlith rule **`blocking-calls`**, gate. It computes reachability from the serving entry through code-facts' file edges (memoized by blob, so its cost follows changed files). It excludes modules reached only from worker, child and host entries, and it excludes declared boot modules. Debt comes from the first run: the 387-call grep census is server-only and not its baseline. | static program |
| Every pass has a driver and a source | `Passes` types; the composition check | compile time; [[a00f91b0]] |
| A call waits only for its own work | integration tests, each holding the foreign resource and asserting the call completes: a background re-measure on the `measure` lane while `submit_work` judges on `gate`; a P3 git build in progress while a graph write answers; a repair epoch applied while a clean `fresh()` returns without a permit; an edit with its graph closed; a merge behind another merge answering `WorktreeMergeQueued` | test |
| Cost follows the touch | op-cost fixtures run the hot operations (touch, instruction step, act closure, doctor aim, territory change, descendants) with a fixed affected closure and output while the unrelated corpus grows tenfold. They assert equal statements and rows read within a constant, and check result completeness separately. | integration test, run in the suite and at merge; not a gate at landing |
| One server | a second server refuses; `kill -9` frees the lock; an old binary is refused at store open | system test |
| Complete telemetry | under forced span drops, histograms match a known count; a gap reads unmeasured; an open hold appears in a snapshot | test |

## 3.5 Owners

| Owner | Owns in this section |
|---|---|
| `packages/held` | `Held`, `Flight`, `Passes`, `Capacity` mechanisms |
| `platform` | the ledger's instance, tickets and envelopes; store writer classes (through `packages/sqlite-process`); the git kit: hooks-off own git, `git hook run`, the per-checkout hook lane (280) and commit lane (290), `commit-tree` and `update-ref` compare-and-set, `index.settle` with the recorded ref's blob as the guard (rank 300); the data-directory lock kit; the ceiling derivations of §3.12 |
| `installation` | the claim at boot; succession on the lock; the machine figures and the budget's inputs |
| `composition` | handing passes, values and start bindings ([[f658e190]]) |
| `graph` | entry gate, leases, eviction; repository and tree permits; P1–P2 under the permit; P3 capture and sync (§3.11); freshness epochs; revisions; the §3.4.5 structures; the catalog request driver |
| `workspace` | the watcher API (paths or rescan) |
| `enforcement` | lanes `gate`, `merge`, `measure`, `reach`; the trigger projection; judgement certificates; after-edit and re-measure passes; the commit-queue append through the kit |
| `worktrees` | provisional branch lock, finishing gates, the archive intent and its recovery pass |
| `landing` | landing intents, witness, receipts, tail driver on the kit's lanes; the preservation commit's intent, witness and receipt; the merge claim, try-admit, request witness, queue, merge receipts and `MergeNotice`; the retirement settlement |
| `threads` | notes lock; the quiet lease's dispatch; `MergeNotice`'s and `NoticeTakeBack`'s implementations; the rollout lane (export, rest, wake, repair) and lost-store import |
| `native-harness` | delivered key per context epoch; compute/wait tool kinds and step concurrency; flush and snapshot lanes; its folds' part in the rollout lane |
| `external-harnesses` | CLI metadata watch |
| `executions` | input and custody gate; terminal disposition |
| `change-record` | the discharge look pass; `heldChanged`; the prepared change's lease |
| `performance` | the metric record contract, stall records, completeness, reports |
| `packages/sqlite-process` | writer classes, aging, large units, permit tokens, undeclared-read counts |

## 3.6 Rejected

- **Guides delivered fire-and-forget in the next step** (Fable §6.3). The touch brief is the law over the lines just touched; it must arrive with the answer. It becomes cheap enough instead.
- **A consumer-side orientation cache** (Fable §6.3). Revisions are kept at the producer ([[2393aff1]]).
- **More workers per lane without measurement** (Astra §6.3). Only the `gate` lane scales, to the heavy slots calls may use, because landing latency is a call's own wait. The other lanes stay one worker until their queue metric shows sustained waiting.
- **A global semaphore over agent calls.** It would add the shared wait this section removes.
- **Refusing agents by count.**
- **Several server processes per directory** (§3.4.7).
- **Cutting at the hold threshold.** A threshold only writes a stall record. The ceiling of §3.12 — a wide margin above normal — is what cuts, and only where the cut leaves a defined state: a rolled-back unit, a cancelled ask, an unpublished act for its driver, an unpublished landing.
- **A per-rule time budget setting.** [[b9bdfa95]] removed it, and §3.12 does not bring it back: ceilings are derived, not configured per rule.
- **P2s ordered by `seq` without holding the permit from P1** (§3.11). P2 regenerates bytes from current rows, so another act's P1 between them makes the bytes differ from the target.
- **Keeping `git commit` and detecting the race afterwards** (v2; Opus B7, Astra S3-4). `git commit` compares against the HEAD git reads, not the judged base. The undo after publication can lose, and it publishes an erasure in the meantime. `commit-tree` plus `update-ref <new> <base>`, with hooks through `git hook run`, is the real compare-and-set and keeps the hooks.
- **Letting landings commit or run hooks in parallel.** The hooks of two landings would change one working tree and index at once, and at most one could win the ref anyway. Hooks run one at a time in the hook lane and publications one at a time in the commit lane. Only building and judging run in parallel.

## 3.7 Acceptance

1. `held-resources` and `blocking-calls` stand at gate with their measured debt. A new violation refuses.
2. An out-of-order acquisition, a re-take of a held key, a join while holding, and a hooks-on git under a hold each refuse, in production builds too.
3. With a re-measure occupying the `measure` lane, `submit_work`'s judgement starts on `gate` without waiting for it.
4. With repair epochs applied, `fresh()` returns without taking a permit while a test holds rank 420. With an epoch observed and not applied, it joins the repair.
5. A graph write answers while another act's P3 git build runs on the same tree.
6. An edit answers with its graph closed, and no lookup runs on its path.
7. **Landing.**
   - Concurrent `submit_work` calls on one checkout build and judge in parallel, up to the `gate` lane's workers, and commit one at a time through the commit lane.
   - With HEAD moved past the judged base, no published commit ever lacks the intervening commit's changes: a test races two landings and a user commit.
   - A rebuilt landing reuses a verdict only when base-side and built-side evidence, negative reads included, all match. It re-runs the rest and every program **outside the lane**.
   - A lane step never judges and never runs a hook.
   - A branch switch between steps 1 and 4 sends the landing back to step 1, even when the new branch has the same sha.
   - On git older than 2.36, `submit_work` refuses `git-too-old` before anything is published.
   - A hook calling `submit_work` on its own checkout completes, or refuses `reentrant`; it never deadlocks.
8. **Crash recovery.**
   - A landing killed before its `publishing` witness is durable is `abandoned` at boot. One killed after it, with no positive receipt, is `uncertain`, and running `submit_work` again resolves it safely.
   - Two landings' hooks never run at once on one checkout.
   - A hook calling `submit_work` on its own checkout gets `reentrant` at once.
   - P3 prepared on a head that has since moved never publishes onto the new head without the intersection check.
   - A ceiling-hit subject never appears in debt.
   - A landing killed after `update-ref` is `committed` by its reflog receipt, even after the user switched branches, and settles its tail.
   - With the reflog gone, it is `uncertain`, never `abandoned`.
   - A settlement racing an outside `update-ref` records its paths `unsynced`, never `synced`. A delayed settlement whose path a later commit owns leaves it `superseded`.
   - A foreign stage made during settlement survives.
   - A writer child killed at a unit's ceiling leaves no next unit running on it. A unit cut after COMMIT answers `uncertain`, and its key settles it.
9. **Merge.**
   - A merge behind another merge on its base answers `WorktreeMergeQueued` with `queue`, or `base-merging` without it, at once.
   - A second request on a `running` root never waits for the first merge.
   - A merge killed after its git effect settles `merged` at boot from its witness, without merging again, and its notice reaches the thread.
10. Op-cost fixtures hold with a fixed affected set on a tenfold corpus.
11. **Memory.**
    - The server's commit and each child's RSS are measured, each process counted once.
    - A holding whose envelope does not fit is refused or queued before it allocates.
    - Growth past an envelope is found at the next sample and answered by the soft path of §3.4.4.
    - The restart ceiling is 0.6 × M.
12. **Refusals.** Writers never refuse by queue length. `busy` is only an admission refusal past 60 s expected wait. An admitted wait past its ceiling answers `stalled`, with `outcome: none` only when nothing took effect and `uncertain` with its key otherwise. A `recovery` unit is never withdrawn.
13. **Ceilings.**
    - A builtin ask forced past its ceiling is cancelled. It answers "not judged: ceiling exceeded" — a refusal at gate whose `unblock` names `enforce_rule` and the defect, `unjudged` at watch — and writes a stall record naming the rule's owner.
    - An ask over the 120 s envelope answers "subject too large" without starting.
    - A background `measure` ask is never dropped by a wait ceiling.
    - A program with no command rule is stopped at the program default.
    - No call in the §3.4.9 test set waits past its declared ceiling, and none has a ceiling above 15 min (30 min for a model request).
14. A second server refuses. After `kill -9` a new start takes the lock. An old binary is refused at store open after the lock release.
15. Under forced span drops, histograms stay exact. A window without snapshots reads unmeasured. A span-derived figure carries its coverage.
16. D9 on the lowest class, under the mixed load, reports:
    - writer turns by class, against the rotation's shares;
    - call waits attributed to background holders, never a background pass's completion;
    - writer call-class p99 wait;
    - loop lag and CPU by owner.
    - **The server's committed memory at 20 agents stays under 0.6 × M (2.4 GiB on 8 GiB), with its p99 over the run.** The one sample here stood at 2.06 GB on a larger machine, so this is not established. If it does not hold, restarts would become the working mode. The finding then reopens the split of M, or the entry and worker envelopes, before this ceiling ships to that class.
    - the landing race rate, and how often a commit lane step re-judged.

    These open the decisions of §2.4.6 and §3.4.6, or they do not.
17. Every pass of §3.4.3 is declared with its trigger and source and is visible.

## 3.8 Findings, claims and tasks

**Built to remove:** F027 (with section 2), F028, F029, F030, F031, F032, F033 and F081. F012's shape is removed by rules 1–2 of §3.4.1 and the kit's hooks check.

**Claims to revise when built:**
- [[74e2e9a6]]: the `measure` lane replaces its limitation, and the restart loss is stated.
- [[de916dff]]: four lanes by class; `gate` runs several workers.
- [[e7729ae1]]: its limitation narrows to the entry gate.
- [[6c4d356d]]: projection moves out of the transaction (section 2).
- [[291cc685]]: its limitation leaves with permit tokens.
- [[fa3df495]]: it still holds for the connection. Its rewrite adds that the store stops a unit past its ceiling by killing and reopening the writer child, fencing the permit meanwhile.
- [[d6b526bc]] is **false now**. Its owner is to unverify it; it is rewritten when the OS lock lands.

**Claims to write from the code when built:**
- `Held`'s refusal rules;
- writer classes and aging;
- large units;
- the ledger and pre-allocation charges;
- eviction's exclusions;
- freshness epochs;
- the watcher API;
- P3's capture under the permit;
- landing intents, the commit lane's compare-and-set and witness;
- certificates with evidence for both sides;
- `index.settle` and its version guard;
- merge claim, try-admit, request witness and `MergeNotice`;
- P3's closed batches, spill and compare-and-set retry;
- tickets, envelopes and soft growth;
- the ceilings of §3.12;
- the trigger projection;
- revisions and delivered keys;
- the data-directory lock and its fence;
- the metric contract.

**Tasks:** one per build step below, each implementing this decision. The debt entries of the two rules are owned by section 1's wave tasks.

## 3.9 Build order

Aligned with section 2's D0–D9.

1. **E0 (in D0 platform):**
   - `packages/held`;
   - writer classes, aging and permit tokens in `sqlite-process`;
   - the metric record contract, stall records and completeness;
   - the OS lock with its chain fence and succession order;
   - the git kit (hooks check, `git hook run`, the hook and commit lanes with bound `(ref, prepared base, tree)` entries, compare-and-set publication, `index.settle` with its post-rename guard), so that E2's P3 can use them;
   - the ceiling derivations of §3.12, and `stalled`;
   - `held-resources` and `blocking-calls` at gate with first-run debt;
   - the rank declaration measured with refusal in tests.
2. **E1 (in D1):**
   - store open without the fill once the completion stamp stands;
   - leases, pre-allocation charges and eviction;
   - handle and watcher accounting;
   - the watcher API and polling trees.
3. **E2 (in D2):**
   - §3.11 — P1–P2 under one hold, P3 capture and sync outside it;
   - `TreeCommits` removed;
   - freshness epochs;
   - topology sync as a pass;
   - the row-only touch unit, and the edit window from the tool's text.
4. **E3 (in D3):** export, rest and wake as declared passes; large units declared.
5. **E4 (enforcement, worktrees and landing waves of D5; landing, preservation commit, merge and `MergeNotice` in landing's, [[f658e190]]):**
   - four lanes, with `gate` scaled to slots, and ask and lane-wait ceilings;
   - `checkRule` enqueue-only;
   - the trigger projection;
   - evidence capture per side and judgement certificates;
   - landing intents, receipts and tails on the kit's hook and commit lanes; the per-root gate removed only in the same change;
   - the merge claim, try-admit, request witness, queue columns and `MergeNotice`;
   - MCP and web-search gates reduced to connecting;
   - the commit-queue append.
6. **E5 (graph wave):**
   - `source(ref, kind)`;
   - revisions;
   - CTEs;
   - the territory closure;
   - op-cost fixtures.
7. **E6 (threads wave, kept, for the lane; native-harness wave for its folds' participant, the delivered key and tool kinds, [[f658e190]]):**
   - delivered key per context epoch;
   - compute/wait tool kinds and S;
   - per-call wait attribution.
8. **E7 (each module's wave):** its passes, its `Held` sites and ranks, its synchronous calls.
9. **E8 (in D9):** the mixed load adds loop lag, CPU by owner, waits by holder class, eviction rate and landing race rate.

## 3.10 The remaining questions of rule [[8dab19b6]]

1–9 are §§3.1–3.9.

10. **Contract.**
    - New refusals:
      - `busy { resource, owner, holders, queued, expectedMs }`, only at entry points;
      - `base-merging` in `BASE_BUSY`, and `merge-running`;
      - the defect `lock-order`;
      - the defect answer `stalled { resource, holder, waited, outcome: none | uncertain, key? }`;
      - `git-too-old`, `reentrant`, `mcp-connecting`, and "not judged: subject too large";
      - the inspection outcome "not judged: ceiling exceeded" (`inspection-failed` with cause `ceiling`, §3.12).
    - Landing commits carry the trailer `Landing: <job id>`, and merge and squash commits carry `Merge: <request_id>`.
    - `merge_worktree` keeps its answer arms.
    - A landing's answer adds `tail: pending | settled`.
    - Tools declare `compute` or `wait`.
    - Edit and write report their hunk span to the touch rule inside the agent kit.
    - Server diagnostics add the ledger, queues, passes and polling trees to `read_performance`.
    - `Held`, `Flight`, `Passes`, `Capacity`, `MergeNotice` and the metric record are versioned contracts (section 6).
    - Every existing answer shape stays.
11. **Stored data.**
    - **Machine chain:**
      - `landing` (landing): job id, checkout, judged base, built tree, paths, attribution digest, the witness commit id, state `building | publishing | committed | settled | abandoned`, and the tail's per-path outcomes (`synced | superseded | unsynced`);
      - `worktree_pending_merge` gains `request_id`, the requesting thread, the `running` and `settled` states, the request witness (base branch and sha, source branch and tip sha, mode), `outcome` and `noticed_at`.
    - **Graph chain:**
      - the `source(ref, kind)` index;
      - `graph_stamp.law_revision`, initialized from the rows at migration, and `vocabulary_revision`, already in §2.4.9.
    - **Not stored:** judgement certificates live in enforcement's memory, and their loss costs one re-judgement. Stall records live in the performance store (§2.4.11 shelf).
    - **Rollback** to the snapshot of §2.10 q11:
      - a `landing` row in `committed` or `publishing` means a commit whose tail the previous binary does not settle; its index sync is reported;
      - pending-merge rows: `waiting` stays; `running` becomes `stopped` with the refusal "interrupted by rollback", so a merge that may already have landed is never run again blindly; `settled` rows are dropped;
      - the index and revisions are derived.
12. **Who may do what.**
    - Owners declare resources, ranks and passes.
    - installation reads the inputs, platform derives, owners declare envelopes ([[f658e190]]).
    - The operator may override the ledger in settings, never below one heavy slot, one reader and the recovery reserve.
    - Checks sit at gate (two rules), in types (`Passes`) and at runtime (`Held`, `Unit.run`, the git kit).
    - A wrong rank shows as a `lock-order` refusal and is corrected in the owner's declaration.
13. **Long-lived things.** Each item below keeps its states, races, leaks and cleanup:
    - **Leases:** held by a call, a subscriber or a pass, never by a run; released by scope.
    - **Entries:** open, serving, idle, evicted or retired.
    - **Pass keys:** idle, waiting, running, then idle or deleted. A trigger during a run earns one more.
    - **Execution tickets:** per phase, released at the phase's end, before any wait on another party, and on interruption.
    - **Envelopes:** from admission to close, grown by the soft path.
    - **Landing intents:** building, publishing, committed, settled or abandoned. `abandoned` means nothing was published; a dangling commit object is left to git's gc.
    - **Commit lane entries:** from the end of judgement to the step's answer.
    - **Merge rows:** waiting, running, settled or stopped, then noticed.
    - **P3 spill copies:** removed after the sync unit.
    - **Other long-lived things:** freshness epochs, the data-directory lock, stall records, judgement certificates.
    - **Races:**
      - a lease against eviction meets at the entry gate;
      - two landings meet in the commit lane;
      - a landing and a commit made outside Tagma meet at `update-ref`'s compare-and-set;
      - two requests of one root meet at the pending gate's try-acquire;
      - settlements meet at `index.lock`;
      - a watcher event during a repair raises the observed epoch;
      - a merge try-admit against a running finishing act gets `base-merging` or a queue row.
    - **Leaks:** keyed gates leave with no holder or waiter; idle pass keys leave after their run; certificates leave with their store generation.
14. **Bounded resources.** §3.4.4 for memory, slots, handles and bytes. Writers are shared by the rotation of §3.4.1. Every wait and every inspection has the ceiling of §3.12. Large units are declared and measured.
15. **Rollout.**
    - The E steps land with their waves.
    - Running threads see shorter waits.
    - The OS lock lands with the D0 chain move, which fences older binaries (§3.4.7).
    - Both rules enter at gate with first-run debt, so no running work is refused.
    - `WorktreeMergeQueued` callers see no new arm.
16. **Failures.**
    - A dropped connection leaves the call's acts to their drivers; its lease leaves with the scope.
    - A restart empties in-memory queues. Durable-sourced passes re-derive their work at boot; advisory passes state their loss (after-edit notices, eviction state).
    - A worker crash fails its one ask, typed, retried once as today.
    - A failing pass backs off and stays visible.
    - A `lock-order` refusal fails the operation, never hangs it.
17. **Observability.** §3.4.8, plus the ledger's use, eviction and polling counts, `busy` by resource, landing race and tail counts, merge queue lengths per base, and loop lag and CPU by owner.

## 3.11 Amendment to section 2 §2.4.8 — for the operator's approval with this section

The operator delegated this choice. It is applied to [[70083b67]] when this section is approved.

**What §2.4.8 says.**
- The phase table gives P1 "tree permit, taken before the writer as today; then the graph-store writer" and P2 "tree permit". It does not say that one hold spans both.
- It gives P3 "tree permit (and the repository permit in shadow mode), after the answer" around the whole landing:
  - reading the paths;
  - `hash-object`, `update-index`, `write-tree`, `commit-tree`, `update-ref`;
  - the checkout index update;
  - the landing unit after the flush.
- Recovery runs under the tree permit.

**What it must say.**

1. **P1 and P2 of one act run under one continuous hold of the tree permit.** The hold is taken before the writer, spans P1's unit, and is released after P2's projected-or-conflicted unit. No other act's P1 or P2, and no repair, runs between them. Row-only operations take no tree permit, as §2.4.8 already declares.
2. **P3 takes the tree permit only to capture its batch and read its bytes.** Under the permit it:
   - **Takes a closed batch.** It starts from the oldest `projected` act, in `seq` order, and adds acts in `seq` order. Whenever an act is added, every later `projected` act planning one of its paths is added too, recursively, so the batch holds the **latest projected writer of every path in it**. A group of acts linked this way is one closure. The byte budget (§3.4.4) is checked only between closures, and the first closure is always taken whole. The batch is never cut inside a closure, so a budget cut cannot leave a later writer of a batched path outside the batch (Astra S3-3), and the next batch never picks the same prefix again.
   - **Reads each planned path once** and verifies it against the target hash of the latest act in the batch that plans it. The bytes read go into memory up to the in-memory budget. A closure larger than that — a single act included, since the budget does not limit what one act may plan — is copied through the kit into a private spill directory beside the tree's store, and verified there. Disk, not memory, bounds it, under §2.4.11's budget.

   Because the batch is taken under the same hold that every P1–P2 needs, no act is between its P1 and P2 at that moment.
   - **A path held back.** A path whose bytes equal the target of a later act that is not `projected` — an `unpublished` act, partly written — is **held back, not conflicted**.
   - **A path in conflict.** Any other difference makes the latest act planning the path `conflicted`, as §2.4.8 says.
   - **Filtering removes whole closures** (Astra S3-3). If any act of a closure is held back or conflicted, the whole closure leaves the batch. Its other acts return to the pending set, and a conflicted one's closure is synced with its resolution (§2.4.8 `resolve_graph_conflict`). A later writer of a shared path therefore is never synced ahead of an earlier act of its closure. The next batch meets no already-synced later writer that its closure no longer contains.
   - **No spinning.** The P3 pass is not triggered again for a held-back closure until the act that holds it changes phase.

   **Outcomes are per act, then per closure.** An act is synced only when every path it plans is either in the published commit or already equal to its target at the head it is synced on. One satisfied path does not sync a multi-path act. Its terminal outcome — `synced` or `conflicted` — and the compaction of its plan follow from all its paths, as §2.4.8 requires.
3. **Everything git does in P3 runs after the permit is released.**
   - `hash-object -w` of the captured bytes, from memory or the spill copy, then the private index, `write-tree`, `commit-tree` with the expected head as parent.
   - `update-ref` against the expected head. On a lost race — a topology sync, or in team mode a commit made outside Tagma — P3 reads the paths the new head changed since the expected one (`git diff --name-only <expected> <new>`):
     - **no intersection with the batch's paths**: the commit is rebuilt on the new head from the same verified blobs and published again;
     - **an intersecting path whose blob at the new head equals the batch's target**: that path is satisfied and leaves the commit. Its acts are synced when all their other paths are also satisfied or published, per act;
     - **any other intersecting path**: the new head changed it, and landing the old blob would revert that change. The latest act planning it becomes `conflicted` with the new head named, as for any foreign edit. Its whole closure leaves the batch, and the rest are rebuilt and published.
   - In team mode, publication and index settlement run as one short step of the checkout's **commit lane**, the `platform` git kit's mechanism (§3.4.2). The entry carries `(ref, prepared head, tree)`. A ref moved past the prepared head exits the lane for the intersection rule above. Otherwise the step runs `update-ref <ref>` with a reflog receipt, and `index.settle` with the recorded ref's blob as the version guard. Tagma's landings and P3 therefore never race each other on one checkout.
   - The landing unit, written after the commit is flushed. The spill copy is removed after it.

   The repository permit is no longer part of P3; git's ref lock and the compare-and-set replace it. A file changed after the read never enters the commit, which is built from the bytes read.
4. Recovery keeps the tree permit for P2 re-drives and takes it for P3's capture exactly as above.

**Why.**
- P2 regenerates bytes from current rows and checks them against the act's target hash. If another act's P1 committed between an act's P1 and its P2, the regenerated bytes would be the later act's. The earlier act would then be declared `conflicted` falsely, or its target would never be written (Opus B1, Astra S3-3). Ordering P2s by `seq` without the continuous hold does not help, because the rows no longer hold the earlier act's after-image. Storing after-images to make that work would add a copy of every act's bytes to the plan. The continuous hold costs one act's P1 + P2, tens of milliseconds for ordinary acts, and that is the serialization section 2 already accepted.
- P3 across git under the permit would make every graph write of the tree wait for a git commit build — F028's and F012's shape. Capturing the batch and its bytes under the permit keeps P3's verification exact. Git then works only on verified bytes, which no later act or edit can change.

## 3.12 Amendment to decision [[b9bdfa95]] — the operator's word: every wait has a sane upper time

To be recorded on [[b9bdfa95]] when this section is approved.

**What [[b9bdfa95]] says.**
- "No enforcement budgets. Builtins must be fast enough to need none. A program is an ordinary command on the execution host, bounded by the project's command rules like any command."
- Its rejected alternatives include "per-rule time budgets", and §13–14 read "Time is bounded by the command rules only."
- A builtin ask therefore runs until it answers or the caller cancels, and a program in a project without command rules has no bound at all.

**What it must say.**

**No per-rule budget setting.** The removed knob stays gone: no `enforcement.*Budget`, no `landing-budget` refusal, nothing a rule configures.

**Every inspection ask has a derived ceiling with an absolute cap.**

T_ask(b) = min(10 s + c_b × F + d_b × MiB, **120 s**)

- F is the number of files the ask's listing covers, and MiB is their size.
- c_b and d_b are **per builtin** (Opus §3.12-4): ten times that builtin's cold cost per file and per MiB in its own committed benchmark, scaled to the lowest class. A builtin without a committed benchmark cannot be enabled at gate.
- The starting figure comes from [[b9bdfa95]]'s `direction` benchmark: the whole server, about 850 files, took 83–109 ms cold on this machine, about 0.13 ms per file. Allowing four times that on the lowest class and a margin of ten gives c = 5 ms per file for `direction`, and a ceiling of about 14 s for this server's landings against a normal of about 0.1 s.
- **Not yet established** ([[fe83acfa]]): the figure for other builtins, and the factor of four for the lowest class. Both are measured on the lowest class in E8, and until then the figures are **starting safety ceilings**, not a proven margin (Astra S3-14).
- **Input envelope.** An ask whose derived figure would exceed the 120 s cap is not started. It answers "not judged: subject too large" and names the builtin's envelope of files and MiB. Enforcing a builtin over a larger reach needs that builtin to slice its work into asks that each fit the cap.

**Waits in an inspection lane.** A call-class ask — the `gate` lane, an explicit `check_rules` — has a lane-wait ceiling equal to its own T_ask. Background asks on the `measure` lane are **not** withdrawn on a wait ceiling: they are coalesced by key, and their backlog is visible (§3.4.3). A running background ask is still cancelled at its own T_ask. It is recorded `unjudged` with a stall record and judged again at its key's next trigger, so nothing is lost silently (Opus §3.12-3).

**Hitting a ceiling is a defect with a defined answer.**
- The ask is cancelled: the worker is stopped, and a fresh one serves the next ask.
- The call gets "not judged: ceiling exceeded" (`inspection-failed`, cause `ceiling`). At gate that is a refusal with that reason, never an endless wait. At watch the rule is named `unjudged`.
- The refusal's `unblock` names both ways out (Opus §3.12-5):
  - the rule's owner loosens the rule in the open through `enforce_rule`'s own contract: moving it to watch, or removing the trigger. A subject that hit the ceiling is **never** written into debt. Debt holds measured violation fingerprints (`enforcement/enforce.ts:251-288`), and a timeout is not one (Astra 4).
  - the builtin's owner receives the stall record as a defect to fix.

  The refusal never offers a bypass.
- A stall record names the rule, its inspection, the subject's size and the rule's owner.

**Programs** are bounded by the project's command rules. Where a project has none, a derived default applies:
- ten times the program's p95 over its last 20 runs in this project, clamped to [60 s, 15 min];
- 15 min before any history exists.

User hooks run by a landing (§3.4.2) take the same default.

**Every wait is bounded end to end, by an absolute cap.**
- **A wait's ceiling covers the whole wait:** queueing, execution and every retry. Retries share one deadline, set when the call is admitted, and never renew it (Astra S3-14).
- **An idle timeout is not a ceiling.** A model stream's idle timeout stays, and a whole-request cap sits above it.
- **Work that answered with a receipt or with progress is no longer a wait.** Its running time belongs to its pass: a queued merge, a first graph copy, a background re-measure. Each running slice of it still has its own cap.

| Wait | Ceiling (absolute cap) | Past it |
|---|---|---|
| A call's first unit, waiting to start at a writer | 60 s | withdrawn unstarted; `stalled { outcome: none }` |
| A call waiting on a `recovery` unit that closes a committed effect | 60 s | `stalled { outcome: uncertain }`; the unit stays queued and runs |
| A running writer unit | 60 s; `large` units 10 min | writer child killed and reopened (§3.4.1 rule 4); `none` before COMMIT, `uncertain` with its key after |
| A `Held` wait of call class (tree permit, entry gate, identity lanes) | the resource's declared ceiling: 60 s by default, 15 min at most | `stalled { outcome: none }` |
| A `Held` hold | its declared ceiling, 15 min at most, with what the cut leaves. P1–P2: P2 stops issuing file operations and finishes the one in flight; the act is left `unpublished` for its driver's three-way check. Index settlement: the one in-flight rename completes or is not issued; Tagma removes only the `index.lock` it created, and the paths are `unsynced`. | cut; stall record |
| An execution ticket | admission: 60 s expected wait → `busy`; queued: 60 s → `stalled { outcome: none }` | as stated |
| A landing, admission to answer | 15 min in total, across hooks, attempts and lane waits; the commit lane's wait: 60 s per entry | before `update-ref` is sent: `stalled { outcome: none }`, intent `abandoned`. After: resolved by receipt (§3.4.2), else `stalled { outcome: uncertain, job }` |
| A cold graph open or first copy | 60 s | the call answers `graph-opening` with progress; the copy goes on as a pass |
| An explicit wait for a pass (`sync_graph`, `run_doctor`, performance reads) | 60 s | the call answers the current state and names the pass still running |
| Joining a `Flight` | the flight's resource ceiling | `stalled { outcome: none }` for the joiner; the flight goes on |
| A model request | idle timeout between events, and **30 min for the whole request, retries included** | typed timeout; the step fails as a provider failure |
| Host verbs, network, MCP tool calls, git readings | each declared, with 15 min at most for the whole call: host verb deadlines, the 30 s checkout reading, the provider refresh timeout, and the program default for an MCP tool call whose server declares none | typed timeout |
| Agent commands in the foreground | command rules, or the program default: 15 min at most | stopped |

**The caps.** 60 s is the bound `busy` uses: past it, an agent is better served by an answer it can act on than by silence. It is at least two orders of magnitude above the normal holds this section sets — 250 ms units, milliseconds for tree permits and lanes. 15 min is the absolute cap for any call's wait, except a model request (30 min), whose normal length is minutes. No ceiling anywhere is open-ended, and none reaches an hour. Every ceiling is shown in its resource's declaration and in its stall records.

**Why.** The operator's word: "there must be an obvious sane upper time — we must never wait 3 hours or a week for any reason." [[b9bdfa95]] removed per-rule budgets because builtins should be fast and programs have command rules. That reasoning still holds for the knob. It does not cover a builtin that stops being fast on some repository, or a project with no command rules, or any other wait this section defines. A derived ceiling keeps the knob gone and still guarantees an answer. Because builtins normally take milliseconds, hitting a ceiling of seconds is a defect worth a stall record. It is never a normal outcome to tune around.

