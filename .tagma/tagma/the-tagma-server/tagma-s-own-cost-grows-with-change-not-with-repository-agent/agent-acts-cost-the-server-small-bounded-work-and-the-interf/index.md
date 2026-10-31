---
id: 01a18cde-5f93-73e8-aa31-64572afe6fec
title: "Agent acts cost the server small bounded work and the interface keeps its latency: exact thread projections, writer programs, owner context, memory budgets"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/store/protocol.ts
---
Every agent act — a hosted tool call, a streamed CLI frame, a state change — passes through the one server process. Today that process spends far more per act than the act costs. The interface is served from the same event loop, so it freezes with it. This spec makes the server's work per act small and bounded. Within a stated load envelope it keeps the interface's latency independent of how many agents run; past the envelope agent work slows by backpressure while the interface stays responsive. It is step 2 ("SQL per act") of the parent spec for the agent path, extended to the writer, thread projections, memory and the fault domain that the 2026-10-30 incident showed. Every user who runs several agents meets the problem; a weaker machine meets it with fewer agents.

## What was measured

Incident: 2026-10-30, 11:21–11:31Z. 22 claude-code threads over ACP, Tagma tools hosted by the server, mostly `read`, `grep`, `glob` and `bash` over this repository. Server instance `16222e97`, build `head-20261029T233502308Z`; code cited below is the current checkout. One machine (12 cores, 32 GB, 27 GB in use), one load, one sample.

| | 11:05–11:15 quiet | 11:21–11:31 incident | 11:31–11:41 after |
|---|---|---|---|
| completed hosted tool calls (`agent.tool-call`) | 10 | 1,380 | 474 |
| `sql.execute` | 15,337 | 685,998 | 232,845 |
| `Store.transaction` | 825 | 14,412 | 4,969 |
| `ThreadSnapshots.publish` | 129 | 5,985 | 2,051 |
| `OwnWork.owing` | 249 | 12,744 | 4,500 |
| `FileRoots.probe` | 528 | 20,749 | 7,893 |

- **Per-call ratios are installation-wide averages.** About 497 statements and 10.4 write units per completed call. Two whole-kept `read` call traces carry 123 and 160 statements and 3 write units in the call's own trace. The rest comes from reactive work that runs outside the call's trace (publications, list and feed projections, ACP steps), plus background. The incident predates per-producer attribution. The current causal ledger reports a retained root's own and disjoint producer counts for statements, units, writer wait and hold, logical SQLite bytes, and spans, with eviction and unfinished tails explicit; it cannot attribute this earlier incident retrospectively.
- **Agent rates.** Per agent: 0.1 hosted call/s and 2.6 host stdout events/s. Tool mix by the activity record: `read` 64%, `grep` 15%, `bash` 10%, `glob` 3%, graph reads the rest.
- **Server loop.** The process took 0.6–1.3 cores against 0.05–0.2 idle. The loop stopped 139 times, 57 s in total, longest 4.9 s. Each long stall's profile is one uninterrupted run of a trivial frame, with heavy system time, under machine memory pressure. That points to collection or paging pauses, not computation (inference). Some stalls show process CPU far above loop CPU (`44a84cec…`, `9913cc1e…`), i.e. off-loop runtime work; the mechanism is not settled.
- **Main-thread busy samples outside pauses.** One profile, `2a2418b3…`, 801 samples: drizzle SQL building ≈20%, SQL transport ≈28% (reply receipt, send, row mapping), the tracer ≈8%. Across the 24 largest stall profiles, ≈30% of non-pause samples are SQL transport.
- **Writer.** Writer wait (`Store.permit.wait`) averaged 437 ms. Bodies under the writer (`Store.execute`) plus commits took ≤ 454 s of the 600 s window, an upper bound because nested units may count twice. Retained slow statements spent 0.02–0.4 ms in the engine. So writer hold is made of loop round trips, not engine work. That supports the parent spec's open hypothesis. `Store.transaction` duration is not hold time: it includes the wait and post-commit tails (span `7c59a7c84455465b`: 19 s, of which 18.5 s is `ThreadEvents.told` after the commit).
- **Memory.** Before the window: RSS 4.31 GB, JS heap 0.92 GB, external 0.51 GB. About 2.9 GB is native memory outside the JS heap; allocator committed 16.7 GB. RSS rose to 7.2 GB during the incident.
- **Telemetry.** The store dropped 76.2M spans and 27.6M metrics since its retention began: work produced, then discarded.
- **Agents' own commands** cost ≈0.07 cores. The execution host took 0.1–0.4 cores. Runners, Claude Code CLIs and the renderer were not measured: load rounds are kept only while the load panel is open.

## Already in place — do not rebuild

- `TableMoves` / `TableAnswers` (`platform/store/moves.ts`, [[baf26b62]]): answers held until a declared write shifts their tables. The command feed already serves marks and terminal rows from memory this way. Its host pulses follow inventory changes (867 in the window), not stdout chunks.
- Folded history is already a revisioned owner cache (`native-harness/transcript/history.ts:122-190`). What multiplies is its SQL freshness probe, which runs once per write unit (`heldIn(unit)`).
- ACP text between durable boundaries already stays in memory; a stdout portion passes in one step (`external-harnesses/protocol/steps.ts:418-445`).
- The SQLite child already caches prepared statements by SQL text (`packages/sqlite-process/src/host.ts:61`).
- Snapshot exactness today: read, check the journal head, repeat inside a write unit when it moved (`packages/agent/src/thread/run/ThreadSnapshots.ts:193-211`, [[7686017c]]).

## The root

1. **Thread state is re-derived from storage on every event.** `ThreadSnapshots.publish` is called imperatively from more than 50 places. Each call re-reads the whole thread state (head, metadata, runs, inbox, pending input, receipts, questions, ending, words wait) whether or not anyone reads it (`ThreadSnapshots.ts:117-139, 298-318`). Every publication wakes whole-state subscribers:
   - the thread list re-reads the summary row, families, three own-work tables and held paths (`threads/list/threadList.ts:141-155, 189-207, 384-401`; `threads/collaboration/ownWork.ts:18-23`);
   - keep-warm reads standing and owed work (`native-harness/keepWarm/driver.ts:170-175, 211`);
   - graph-copy holding re-evaluates (`composition/threadCopies.ts:86`).
2. **The writer is held across loop scheduling.** A unit's body runs on the event loop inside the writer transaction (`platform/store/transaction.ts:128-171`). Every statement is a round trip through the loop, so any loop pause lengthens every waiting writer. A tool call's bookkeeping is spread over several units, and every unit repeats freshness probes.
3. **Context that changes rarely is re-resolved per request:** settings layers, provider accounts, enabled plugins and hooks, file-root registry rows, the caller's grant (`invocation/admission/identity.ts:55-62`, the most frequent stored statement in the incident).
4. **Every statement and every span costs the main thread.** Drizzle rebuilds SQL text and the row mapper on every call. Rows cross the process boundary by structured clone. Each statement opens a span, and fingerprints are computed only for sampled spans (`packages/sqlite-process/src/connection.ts:294-317`).
5. **ACP durable steps cost in proportion to the open turn.**
   - Each durable step re-encodes and upserts the whole protocol row as JSON from the row it holds in memory (`steps.ts:510`, `external-harnesses/store/protocol.ts:57-66`); the reactor's `stored` path also reads and decodes it first (`steps.ts:289-306`).
   - Every tool-call status change is made durable (`steps.ts:91-94, 426`), although later status changes of hosted calls never reach the journal ([[ae10d61d]]).
   - Each step reads the journal once per standing call (`steps.ts:586-589`).
6. **Memory has no budget.** The server carries a ~1 GB JS heap and ~3 GB native memory before any load, so collections and paging scale with what is retained, not with the work.

Kind: a design decision — state re-derived on pull, the writer coupled to loop scheduling, context resolved per request — and inside it a defect: recomputing an unchanged projection breaks [[2393aff1]].

## What will stand

### A. Thread state is a versioned projection the thread's owner keeps exact

- **Three clocks per thread, their relation explicit.**
  - *Change revision*: committed, monotonic per thread, advanced by every program that changes the thread's readable storage. That includes writes that append no journal event: run phase, progress and heartbeat-visible run fields (`native-harness/runs/ledger.ts:63-83`), the title (`threads/turns/adjustments.ts:50-66`). It orders changes, detects gaps and rejects duplicates.
  - *Journal position*: the exact cut for transcript facts, as today ([[7686017c]]). Many changes may share one position.
  - *Live sequence*: per incarnation, for open entries and progress, as `FeedPosition.seq` today (`packages/agent/src/transcript/live.ts:11-14`).

  No transcript fact is manufactured to version a heartbeat or a status.
- **Typed changes.** Every program that changes readable state carries a typed change: the thread, its change revision, its journal position, and the written facts themselves (entry revisions, run, inbox and question rows). A change never says only "thread T moved". Each stored entry revision records the position that wrote it.
- **Completeness is enforced.** Declared write sets extend from tables to keys, building on `TableMoves`. A write to a projected table without a declared change is refused, not printed. A shadow mode, run apart from performance measurement, recomputes each projection from storage after each flush and diffs it.
- **One owner per projection.** Today's `ThreadSnapshots` and `ThreadFeed` in `packages/agent` keep, per followed thread:
  - the state at a change revision;
  - the newest transcript page;
  - the open entries in a bounded resident form. An open entry larger than the resident bound keeps its identity, length and newest chunk in memory. Its whole text stays durable in the run's stream tail (`thread_run.stream_tail`), and text leaves memory only once the tail holding it is durable. Nothing is lost and no text length ceiling appears ([[a99bba00]]);
  - a bounded window of deltas.

  The owner applies changes in change-revision order. Application is idempotent: an entry revision applies only over an older recorded position.
- **Snapshot and `attachFrom` are served from the projection at its applied cut** — change revision, journal position and live sequence. They are exact by construction:
  - a snapshot is state, page and open entries at that cut;
  - `attachFrom(since)` answers deltas from the window, or a snapshot when `since` fell out of it;
  - an oversized open entry travels in chunks. Its frame names the entry, its total length and the offset of what it carries, and the client reads the prefix it lacks by offset. This extends `ThreadOpenChange` on the wire.

  Older pages are read from storage as today.
- **Hydration is one storage snapshot.** The first follower installs the change subscription first. It then reads metadata, runs, inbox, pending input and the newest page in one read transaction, which also answers the thread's change revision R. Buffered changes above R apply; those at or below R are dropped. Open entries come from the live feed's owner at the live sequence it holds when hydration completes. A gap in change revisions re-hydrates. Lock order stays Residence → `atCut` → write unit ([[a92c2538]]); hydration takes no writer.
- **Inputs that are not storage** reach the projection as typed transient changes on the same per-thread lane as committed ones: launch gate, words in flight, resting and transports (`packages/agent/src/thread/run/LaunchGate.ts:15-24`, `WordsInFlight.ts:19-39`). Status deadlines are timers the projection owns (today's `arm` / `reconsider`). A transient change advances the frame sequence, never the change revision.
- **Narrow events for other consumers.** The thread list, keep-warm, graph-copy holding and attention subscribe to typed events derived by the projection owner: list-row fields changed, run started or ended, status class changed, owed work changed. They no longer subscribe to whole states. Their own projections — the list row, the own-work flags — are maintained from these events. A thread nobody follows costs its changes' event derivation and nothing else.
- **Coalescing** applies to replaceable state frames, at most one per key per commit batch. It never applies to journal facts or live deltas, which each apply once.
- **Publications follow commits.** The imperative `publish(threadId)` calls go away as their producers emit changes.

### B. A write unit is a program the writer runs alone

- **Programs.** A program is the unit's statements with its guards: an expected row count, a revision condition or a uniqueness constraint. The store sends it to the writer child as one message, and the child executes it between BEGIN and COMMIT. Writer hold becomes engine time. No unit's hold depends on the loop.
- **Decisions stay atomic.** Check-then-act decisions are made against owners' memory. The program carries a guard for every persisted fact the decision depended on: the aggregate's revision, and the revision of each other owner's fact it read. Examples:
  - the facet read and write in `HarnessSessionStore.settle` (`external-harnesses/store/sessions.ts:99-127`);
  - terminal reserve (`executions/terminals/start.ts:197`), whose `CommandAccess.recheck` re-resolves policy, authority and the owner fence (`executions/commands/access.ts:324-344`); each becomes a guard;
  - the run-still-ours check of hosted entries.

  An owner whose answer can gate another owner's decision hands out a revision token with that answer, and a guard statement that checks the token inside the writer transaction. A guard failure aborts that program alone and returns a typed conflict; the owner reloads and decides again. An owner applies the program's effect to its memory only after the commit is acknowledged.
- **Group commit.** Programs queued while one runs commit together in the writer child, within a bound on programs and bytes per batch:
  - one SAVEPOINT per program, so a guard or statement failure rolls back that program alone;
  - a COMMIT or I/O failure fails the whole batch, and every member is answered with it;
  - the batch's synchronous mode is the strictest of its members;
  - per-program results;
  - nested units join their outer program, as the nested join of `transaction.ts:198-204` does today;
  - after-commit effects run in commit order.
- **An unacknowledged program may have committed.** The child commits before it replies (`packages/sqlite-process/src/host.ts:59-66`), and committed WAL survives its death ([[15a15cc2]]). So every program carries an owner-stable operation identity. Its owner keeps durable evidence that recognizes a committed outcome on recovery without repeating it — its own receipt row, request key or entry position, reused where one exists. Effects published after a commit (feed frames, notifications, ACP frames) are recovered by their owner from committed state, never assumed lost or done.
- **Boundaries stay where an external effect or an acknowledgement stands:**
  - the terminal start's `reserve` / `dispatched` commit precedes `host.start`, and the receipt side (`accepted`, `record`, or `uncertain`) commits after it (`start.ts:193-305`);
  - stop and discharge likewise;
  - an ACP durable step commits before its frames ([[e47bd3fc]]);
  - a hosted tool result waits for the durable assistant message ([[ae10d61d]]).

  Each merges into one program per side of its boundary, never across it.
- **Migration by rank.** Units become programs in ledger rank order, the hot path first: hosted call start and end, run phase, journal append, owed calls, terminal lifecycle, ACP step. Interactive units remain only during migration; the store reports their writer hold by operation, and the interactive form is retired when the ledger shows none on a hot path.

### C. Rarely changing context is answered by its owner from memory

- **Owner answers by revision.** Settings layers, provider accounts, enabled plugins and their hooks, the root registry and orientation law keep their current answer, built on `TableAnswers` revisions ([[51c66cb6]]). Settings also invalidate on graph sync and import.
- **Admission caches only what is stable.** It keeps the caller's stable grant identity, keyed by credential and thread revision. The call's target, act header and standing are resolved per request (`invocation/admission/project.ts:146-188`, `identity.ts:102-116`).
- **File roots** keep their acquisition-time identity check: a moved or replaced directory must still be caught when no watcher event arrived. One call's probes become one batch, and the registry rows come from memory.
- **History** takes its freshness from the aggregate's in-memory revision instead of a SQL probe per unit.

### D. A statement and a span cost the loop almost nothing

- **Prepared queries.** Hot queries are drizzle prepared queries (`.prepare()` with placeholders), so SQL text and the row mapper are built once.
- **Batched reads.** One logical read needing several statements sends them in one round trip. It names whether they share one read snapshot; a projection's hydration always does.
- **Statement accounting** happens at the execution boundary for every statement, sampled or not: counts and time by fingerprint and by root act. It never depends on a retained span.
- **Unsampled spans are near-free:** no attribute projection, no byte sizing. Statements become spans only inside a trace being kept, through a bounded tail buffer. Telemetry produces only what it can keep.

### E. An ACP durable step costs in proportion to what it changed

- **Changes, not snapshots.** The protocol owner keeps the row in memory (`link.row`) and writes what changed — normalized rows or deltas — instead of re-encoding the whole row. A step reads no journal row it already holds.
- **Durability by reason.** Tool-call status changes are durable only where a reader of the stored row needs them. Why `moved` is durable today is established first.
- **Text accumulation** is measured in bytes processed per message byte (`packages/acp/src/draft.ts`), and is made linear if it is not.

### F. Memory has budgets

- **Census.** The census names what holds the idle and the loaded server: JS heap after a full collection, by retainer through heap snapshots, plus native and allocator memory.
- **Every in-memory owner declares its bound** and evicts past it. That includes the projections of A and the caches of C, which add to the heap whose pauses froze the loop. Uncommitted programs, live facts owed to a follower and pending notifications cannot be evicted; they are bounded by B's batch bounds and G's backpressure.
- **Budgets recorded here** before the work they gate: idle server memory after full collection, and server-resident memory per active agent. Target: ≤ 10 MB per active agent.
- **Lingering sessions.** Stopped ACP threads kept their runner and CLI: 31 runners and 39 CLIs held 5.8 GB at 11:50Z. Their lifetime gets a stated rule from their owner.

### G. The interface keeps its latency within a stated envelope

- **Envelope.** Supported: up to 50 agents at the incident's per-agent rates, on the reference profile, with the payload sizes of the Proof. Past it, agent work slows; the interface does not.
- **Bounded ingress.** Agent acts enter through bounded queues per owner: hosted calls, ACP steps, program batches, projection application. A full queue pushes back on its producer — the runner's call or the CLI's stdout read waits — instead of growing memory. A projection consumer that falls behind its delta window is re-hydrated, not fed an unbounded backlog.
- **A reserved path.** Interface and control work — graph, files, settings, thread open, stop and interrupt — is served ahead of agent work and never waits behind an agent queue.
- **The isolation decision is measured.** A JS heap shared with agent work bounds interface latency only as far as that heap's pauses are bounded. If after A–F the bench misses an interface or pause gate on the reference profile, the census and the causal ledger name the owner whose work or retained memory causes the miss. That owner leaves the serving isolate, behind the change stream and writer messages that A and B build. Which owners move and how many workers run follows from those numbers. Moving loop-owned code alone may not remove a pause: some stalls show process CPU far above loop CPU (`44a84cec…`). Machine memory and the writer stay shared whatever moves.

## Considered and rejected

- Debouncing or throttling publications: hides the cost at the consumer and delays truth.
- One write unit for a whole tool call: crosses host effects and ACP acknowledgements.
- Generic optimistic transactions with buffered writes and read revalidation for every unit: units read their own writes inside the unit (a journal append followed by `ThreadStorage.suffix.replay` in one `Store.execute`), so buffering breaks them. Programs are introduced per owner instead.
- More SQLite readers: the engine is idle.
- Another IPC format: rejected by the parent spec. D removes the measured drizzle share instead.

## Work order

0. **Ledger, bench and census; no behaviour change.**
   - The parent's step 0 extended with causal attribution: a root act's cause travels into its after-commit tails, publications, projections and ACP steps.
   - Per act: statements, programs and units, writer hold, encoded bytes, spans.
   - Process allocation per act over a steady interval.
   - The workload below.
   - Baseline and budgets recorded in this spec.
1. **B**, first by measurement: in the 5× stress run the writer was the ceiling. Loop p99 stayed at 7 ms while writer wait p99 reached 2 s and throughput capped near 9 calls/s. 89.6% of all writer hold was outside the child. `HarnessSessionStore.change` (ACP protocol row) and `ThreadStore.kernel` (journal append) held 95% of it; they migrate first.
2. **E** with the same owner as B's `HarnessSessionStore.change` migration, or right after it: the protocol row write shrinks to what changed.
3. **A**, producers by ledger rank; the thread list, keep-warm and graph-copy holding move to narrow events.
4. **C and D**, by rank.
5. **F**.
6. **The G gate.**

## Proof

**Workload** — a testbed bench, so it is a test and not a live check:
- open-loop arrivals through the real doors: a fake runner calling `open_hosted_turn` and `call_hosted_tool` with the incident mix at 0.1 call/s per agent over a fixture repository, and a fake ACP CLI at 2.6 frames/s per agent;
- one agent in five idle on the model (beats, leases, keep-warm);
- subscribers as at the incident's longest stall: `thread.changes` ×8, `artifacts.thread` ×8, `worktrees` ×6, and `commands`, `threads`, `calls`, `views`, `graph`, `holdings`, `checkout`, `tree` ×4 each;
- also zero subscribers, and subscribe, unsubscribe, reconnect, rewind, compaction and external file changes during commits;
- N = 0, 10 and 50 at the incident rates, and a 5× rate stress run;
- sizes at a few distinct points: tool results of 2 KB, at the hosted response cap, and 1 MB produced over it — the path the door takes for output beyond the cap; assistant messages of 1 KB and 200 KB; 1 and 8 calls per assistant boundary; histories of 100 and 10,000 entries; the parent's repository, project and subscriber axes;
- steady-state runs at N = 50 for the loop and memory gates, fitting the project's 30-minute command life whole: a ~25-minute load window, the first ~8 minutes warm-up. Each is one uninterrupted program in the measuring lane of the tests skill, never split or resumed;
- performance runs without the shadow mode; shadow equality is its own correctness run;
- the parent's constrained 4-core / 8 GB profile as the reference profile.

**Gates on counts** (machine-independent, ledger attribution, the subscriber mix above), for a steady-state hosted `read`:
- ≤ 20 statements, reactive work included;
- ≤ 2 bookkeeping programs (call start, call end); the ACP message program counts once per assistant message boundary, separately;
- each projection recomputed at most once per key per commit batch, and zero storage reads for a change applied incrementally;
- telemetry ≤ 5% of server CPU at N = 50.

**Relative gates** (same machine, same bench): server CPU per act and allocator-requested bytes per act ≥ 10× below the step-0 baseline. Bun 1.4.4 exposes no exact per-isolate JS allocation counter; `mimalloc.malloc_requested` is process-wide, workers and native traffic included, so it is compared only between runs of the same bench composition.

**Interface gates** at N = 50, each measured on a finite boundary:
- graph block open: request arrival to answer;
- thread open: request arrival, admission and queue included, to the first usable snapshot or resume frame delivered;
- thread-list update: the causing commit to the delivered list frame.

Each holds p99 ≤ 100 ms on the reference profile ([[c57e2aa9]]) and ≤ 1.5× its N = 0 figure on the same machine. In the 5× stress run the same boundaries hold p99 ≤ 250 ms while agent acts are pushed back.

The e2e lane's `tagma.thread-open` p99 is reported beside them: renderer cost is outside this spec.

**Loop and memory gates** at N = 50 on the reference profile, heap size reported beside each:
- loop delay p99 ≤ 20 ms, no stall over 100 ms;
- collection pauses are reported beside these gates, not gated: Bun 1.4.4 gives no bounded, exact mutator-pause stream of the serving isolate (GC log lines carry no tested isolate mapping; `GCProfiler` times concurrent cycles). The loop-delay and stall gates are what the interface feels whatever the pause's cause;
- writer wait p99 ≤ 20 ms;
- program hold p99 ≤ 5 ms;
- backlog and retained memory flat over the last 15 minutes of the steady-state run;
- the F budgets hold.

**Correctness:**
- kill -9 between a group commit and its reply: the committed program is recognized on recovery and not repeated, a duplicate submission is recognized, and its publications are recovered from committed state;
- a COMMIT failure answers every member of its batch;
- a guard conflict aborts only its program and is decided again;
- a decision's dependency changes while its target aggregate does not: the guard refuses;
- several storage and transient changes at one journal head, across reconnect and a timer transition;
- an open entry larger than the page budget, with a reconnect while it grows;
- hydration interleaved with a rewind or restore and a late entry;
- durability merge and after-commit order;
- terminal start and stop recovery across their boundaries;
- ACP step-before-frames and result-after-message contracts;
- projection shadow equality under random operation sequences, rewind, compaction and restore included;
- snapshot and `attachFrom` exactness under concurrent appends: deltas applied over a snapshot equal the later snapshot;
- hydration during concurrent commits;
- refusal of undeclared writes;
- differential tests of every C owner against a fresh read, external file changes included.

## Baseline

The first complete baseline is a **pre-fix reference**, measured on commit `fb19c85618` on one 12-core, 32 GB macOS arm64 machine with Bun 1.4.4. The bench includes one project, one small fixture repository, synthetic 100-entry histories, a 2 KB tool-result fixture, 54 incident subscriptions, and open parent-task turns; one agent in five is idle. Short runs measured 90 s after 15 s warm-up. These figures are not measurements of the later hosted-call fiber fix, and the machine is not the 4-core/8-GB reference profile.

| Agents | Hosted calls completed | Loop p99 / stalls over 100 ms | Graph / thread / list COMMIT-to-frame p99 upper bound |
|---|---:|---:|---:|
| 0 | 0 | 2.032 ms / 0 | 59 / 71 / 49 ms |
| 10 | 72 | 2.370 ms / 0 | 47 / 55 / 26 ms |
| 50 | 360 of 361 submitted | 5.738 ms / 0 | 34 / 50 / 29 ms |

At N=10, 48 attributed reads averaged 201 SQL statements and 2 write units; at N=50, 231 reads averaged 202.19 statements and 2 units. N=50 process CPU was 50,623.961 ms and process-wide mimalloc allocator-requested traffic was 47,946,953,312 B, including the driver, probes, worker isolates and native allocation. The physical writer wait/hold p99 upper bounds were 20/20 ms over 4,626 units. Writer rows evicted 3,135 observations with a cursor gap; the causal ledger evicted 9,803 roots, detected no cursor gap, and still followed four tails. These populations cannot be reconstructed as complete per-act samples.

The uninterrupted N=50 steady run used 480 s warm-up and 1,020 s measurement, taking 1,550.4 s including two snapshots and teardown. It completed 4,081/4,081 submitted calls without failures; loop p99 was 6.357 ms with no stall over 100 ms, and writer wait/hold p99 upper bounds were 25/25 ms over 52,473 units. The ledger evicted 164,749 roots without a detected cursor gap and had no tails still followed; writer-row retention had a gap. Sampled memory was not flat over the last 15 minutes.

The post-full-GC census, including the in-process fixture and excluding child processes, was: idle N=0 RSS 464,455,144 B, JS heap 134,831,661 B, external memory 66,117,261 B, and allocator committed 995,229,696 B; steady loaded N=50 RSS 1,730,530,328 B, JS heap 779,021,840 B, external memory 207,076,608 B, and committed 3,125,870,592 B. Heap retained-size examples overlap; these readings do not assign all native memory or prove an exclusive retaining owner.

In matched N=50 open parent-task samples on this machine, 240 s warm-up followed by 480 s measurement, the investigation found successful hosted-call fibers held until their run ended. Commit `5556c2e7` releases completed fibers while preserving recorded replay and background-call ordering. Post-full-GC heap grew 157,736,820 B over 1,959 calls before the fix and 51,870,199 B over 1,958 calls after it (19.32 versus 6.36 MB/min): a 67.1% reduction in these samples, not a plateau. Fibers with cached `call_hosted_tool` spans grew from 922 to 2,881 before the fix and remained at zero in the post-fix pair; most remaining self-byte growth was outside the snapshot's strong-root walk, so its owner is not established.

A separate post-fix **finite-turn census** ran commit `9125252453` on the same 12-core, 32 GB macOS arm64 machine with Bun 1.4.4, 50 agents, 54 subscriptions and the same 2 KB fixture and synthetic 100-entry histories. Its turns are operator-driven after workflow priming: unlike the open parent-task baseline, they do not exercise the parent's outstanding-task keep-warm path. Each active turn targets 20–50 calls, waits for successful confirmed settlement and hosted-run release, then opens the next turn. During the 480 s interval following 240 s warm-up, 58 turns settled, averaging 34.86 calls; 1,919 calls were submitted and 1,935 completed, with 16 outstanding at the start and none at the end, and no measured failures. The finite pauses make this a distinct composition, not a replacement for the open-parent baseline or a 15-minute flatness proof.

At the warm and loaded full-GC cuts, 489.371 s and 1,958 completed calls apart, RSS was 1,103,874,736 B and 1,158,810,960 B, JS heap 351,340,241 B and 376,972,717 B, external memory 182,355,201 B and 197,794,461 B, and allocator committed 2,666,659,840 B and 3,536,781,312 B. Heap rose 25,632,476 B; the earlier fixed open-parent sample rose 51,870,199 B over 1,958 calls, but the different turn and cache composition prevents attributing their difference to a particular owner. After the final heap cut, provider-paired logical JSON histories averaged 329,070 B for the 40 active threads and 74,308 B for the ten idle threads. These are serialized logical sizes, not resident memory, a warm-to-end history delta, or a measured expansion factor; reading them warms the independently bounded history cache. Between the finite cuts the snapshots contained 5,986 additional `Message` nodes (383,104 self bytes) and 39,136 additional strings (10,266,970 self bytes); most added `Message` self bytes lay outside the exposed strong-root walk, so these counts do not establish an owning retainer.

In this finite-turn interval loop p99 was 8.569 ms with no stall over 100 ms; graph, thread, and list COMMIT-to-frame p99 upper bounds were 70, 113, and 52 ms respectively, with all 240 probes completing before the cut. Physical writer wait/hold p99 upper bounds were 75/25 ms over 27,872 units. The ledger evicted 79,668 roots with no detected cursor gap and one tail still followed; writer rows had a retention gap. GC logging sampled a 16.434 ms p99 but had 300 ambiguous fragments and unverified completeness. Fixture cleanup interrupted some calls after the census; their HTTP 503s were outside the measured interval.

A post-fix **5× open-parent stress sample** used the same machine and source build `9125252453`, 50 agents, the 54 subscriptions, 15 s warm-up and 90 s measurement. The bench submitted 1,802 calls and completed 836; outstanding calls grew from 174 to 1,140, with no measured failures. Of 45 scheduled interface probes, all graph and thread probes completed: graph p99 upper bound was 96 ms and thread open was 913 ms, above the 250 ms stress target on this machine. Only 34 list probes completed before the cut; their offered-to-frame sample median upper bound was 16,384 ms, while 11 remained outstanding, so a population p99 for COMMIT-to-frame is unproved even though the 34 observed COMMIT-to-frame samples had a 51 ms p99 upper bound. This is a short overload observation, not a steady-state or reference-profile result.

The stress sample had loop p99 7.016 ms and no stall over 100 ms; physical writer wait/hold p99 upper bounds were 2,000/40 ms over 9,008 units. The ledger evicted 28,369 roots, detected 1,616 missed roots, and still followed 226 tails; writer-row retention had a gap. The observed request backlog grew rather than being held at bounded ingress. GC p99 was 26.563 ms in the diagnostic sample with 127 ambiguous fragments and unverified completeness.

A 5× **causal-attribution repeat** used bench `cf01bf3548` plus an uncommitted additive SQLite-program delta that was not wired into any operation and remained byte-identical throughout. Its dedicated bounded ledger and probe-stage instrumentation make it a diagnostic repeat, not the identical `9125252453` build. It submitted 1,802 calls, completed 834, and grew outstanding from 187 to 1,155 in 90 s. The physical writer held 8,990 units for 88,800 ms; 10,280 ms was acknowledged child elapsed and 78,520 ms (88.4%) was outside, including scheduling and bookkeeping as well as loop round trips. The two largest operations accounted for 95.0% of hold.

| Writer operation | Units | Hold sum | Hold p50 / p99 upper bound | Child / outside sum |
|---|---:|---:|---:|---:|
| `HarnessSessionStore.change` | 4,211 | 61,601 ms | 15 / 50 ms | 7,300 / 54,301 ms |
| `ThreadStore.kernel` | 3,339 | 22,745 ms | 5 / 30 ms | 2,272 / 20,474 ms |
| `start.reserve` | 235 | 1,160 ms | 5 / 20 ms | 155 / 1,005 ms |
| `discharge.discharge` | 264 | 1,052 ms | 4 / 20 ms | 146 / 907 ms |

Of the hosted roots that began in the window, ended and had a five-second tail allowance, 647 roots carried 3,315 own Store units, 5.124 per root. The 434 `read` roots and 55 `read_block` roots each had 4 own units on average; 84 `grep` roots averaged 8.952, 19 `glob` roots 9, and 55 `bash` roots 7.927. Their `ThreadSnapshots.publish`, `ThreadList.project` and `KeepWarm.look` producers incurred no counted Store units, though publication and list projection ran SQL. The separately opened ACP stream is not a child of a hosted call: 21,792 retained `ProtocolSteps.run` roots carried 4,164 `ProtocolSteps.saved` Store units. Dividing by 834 completed calls gives 4.99 units per completion only as an installation-window ratio, not causal per-call attribution. The probe ledger had no evictions or detected gaps but still followed 1,156 roots; the 647 ended roots are a selected subset. Direct transactions in the separate activity database can incur writer hold without incrementing the Store-unit counter; shared activity batches are charged to the first accepted cause.

Among 33 completed list probes, the fixture's own serial queue waited 11,802 ms on average, the title request took 2,509 ms, and its matched physical writer permit waited 811 ms with 1.45 ms hold; initial list frames averaged 17 ms. The fixture queue is not product projection latency. Twelve of 45 list probes were outstanding at the cut, so the population COMMIT-to-frame p99 is unproved; 33 observed samples had a 57 ms p99 upper bound. All 45 thread opens completed; subscribe-to-frame and server `ThreadFeeds.open` p99 upper bounds were both 2,048 ms. Thirty-six slow open spans were retained, but the diagnostic filtered on `threadId` while the tracer stores the key as `thread.id`; the filter omitted the spans, and the fixture closed before they were read again. The source of individual thread-open delays remains unproved.

List latency is writer-side COMMIT return to delivered frame across process epoch clocks whose skew is not bounded. Writer percentiles cover physical outer units and child elapsed is not engine CPU. GC attribution is diagnostic and its completeness is unverified; loop delay and stalls are the gate. No resident-memory budget or reference-profile pass is established by this sample.

## Not established

- The owner and expected conversation/history contribution of the remaining post-full-GC heap growth after the hosted-call fix; a plateau and an exclusive retainer have not been established.
- Collection versus paging as the stall mechanism, and the off-loop runtime work seen in some stalls.
- Why tool-call status changes are durable on ACP.
- Whether text accumulation is quadratic.
- What the 8.5 s and 16.5 s gaps without spans before and after a retained `read` call's execution were waiting on (trace `d4ba3a6c…`).
- Runner, CLI and renderer cost under load.
