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
Every agent act — a hosted tool call, a streamed CLI frame, a state change — passes through the one server process. Today that process spends far more per act than the act costs. The interface is served from the same event loop, so it freezes with it. This spec makes the server's work per act small and bounded. It keeps the interface's latency independent of how many agents run. It is step 2 ("SQL per act") of the parent spec for the agent path, extended to the writer, thread projections, memory and the fault domain that the 2026-10-30 incident showed. Every user who runs several agents meets the problem; a weaker machine meets it with fewer agents.

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

- **Per-call ratios are installation-wide averages.** About 497 statements and 10.4 write units per completed call. Two whole-kept `read` call traces carry 123 and 160 statements and 3 write units in the call's own trace. The rest comes from reactive work that runs outside the call's trace (publications, list and feed projections, ACP steps), plus background. No per-producer attribution exists yet.
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
   - Each durable step decodes and re-encodes the whole protocol row as JSON (`external-harnesses/store/protocol.ts:42-66`).
   - Every tool-call status change is made durable (`steps.ts:91-94, 426`), although later status changes of hosted calls never reach the journal ([[ae10d61d]]).
   - Each step reads the journal once per standing call (`steps.ts:586-589`).
6. **Memory has no budget.** The server carries a ~1 GB JS heap and ~3 GB native memory before any load, so collections and paging scale with what is retained, not with the work.

Kind: a design decision — state re-derived on pull, the writer coupled to loop scheduling, context resolved per request — and inside it a defect: recomputing an unchanged projection breaks [[2393aff1]].

## What will stand

### A. Thread state is a versioned projection the thread's owner keeps exact

- **One version per thread.** The thread's journal position is its version. Every write that changes a thread's readable state carries a typed change: the thread, the position it commits at, and the written facts themselves (entry revisions, run, inbox and question rows). A change never says only "thread T moved". Each stored entry revision records the position that wrote it.
- **Completeness is enforced.** Declared write sets extend from tables to keys, building on `TableMoves`. A write to a projected table without a declared change is refused, not printed. Tests and the bench run a shadow mode that recomputes each projection from storage after each flush and diffs it.
- **One owner per projection.** Today's `ThreadSnapshots` and `ThreadFeed` in `packages/agent` keep, per followed thread:
  - the state;
  - the newest transcript page and the live tail, both bounded by the wire page limits;
  - a bounded window of deltas.

  The owner applies changes in position order. Application is idempotent: an entry revision applies only over an older recorded position.
- **Snapshot and `attachFrom` are served from the projection at its applied position P.** They are exact by construction:
  - a snapshot is state, page and live tail at P;
  - `attachFrom(since)` answers deltas from the window, or a snapshot when `since` fell out of it.

  Older pages are read from storage as today.
- **Hydration.** The first follower installs the change subscription before reading storage, buffers changes, reads at the head, then applies buffered changes newer than what it read. A detected gap (a missing position) re-hydrates. Lock order stays Residence → `atCut` → write unit ([[a92c2538]]).
- **Inputs that are not storage feed the same projection as typed changes:** launch gate, words in flight, resting, transports. Status deadlines are timers the projection owns (today's `arm` / `reconsider`).
- **Narrow events for other consumers.** The thread list, keep-warm, graph-copy holding and attention subscribe to typed events derived by the projection owner: list-row fields changed, run started or ended, status class changed, owed work changed. They no longer subscribe to whole states. Their own projections — the list row, the own-work flags — are maintained from these events. A thread nobody follows costs its changes' event derivation and nothing else.
- **Coalescing** applies to replaceable state frames, at most one per key per commit batch. It never applies to journal facts or live deltas, which each apply once.
- **Publications follow commits.** The imperative `publish(threadId)` calls go away as their producers emit changes.

### B. A write unit is a program the writer runs alone

- **Programs.** A program is the unit's statements with its guards: an expected row count, a revision condition or a uniqueness constraint. The store sends it to the writer child as one message, and the child executes it between BEGIN and COMMIT. Writer hold becomes engine time. No unit's hold depends on the loop.
- **Decisions stay atomic.** Check-then-act decisions are made against the aggregate owner's memory, with the aggregate's revision as a guard in the program. Examples:
  - the facet read and write in `HarnessSessionStore.settle` (`external-harnesses/store/sessions.ts:99-127`);
  - the command recheck in terminal reserve (`executions/terminals/start.ts:197`);
  - the run-still-ours check of hosted entries.

  A guard failure aborts that program alone and returns a typed conflict; the owner reloads and decides again. An owner applies the program's effect to its memory only after the commit is acknowledged.
- **Group commit.** Programs queued while one runs commit together in the writer child:
  - one SAVEPOINT per program, so a failing program rolls back alone;
  - the batch's synchronous mode is the strictest of its members;
  - per-program results;
  - nested units join their outer program, as the nested join of `transaction.ts:198-204` does today;
  - after-commit effects run in commit order.

  A crash loses the whole unacknowledged batch and nothing acknowledged.
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
- **Batched reads.** One logical read needing several statements sends them in one round trip. It names whether they must share one read snapshot.
- **Statement accounting** happens at the execution boundary for every statement, sampled or not: counts and time by fingerprint and by root act. It never depends on a retained span.
- **Unsampled spans are near-free:** no attribute projection, no byte sizing. Statements become spans only inside a trace being kept, through a bounded tail buffer. Telemetry produces only what it can keep.

### E. An ACP durable step costs in proportion to what it changed

- **Changes, not snapshots.** The protocol owner keeps the row in memory (`link.row`) and writes what changed — normalized rows or deltas — instead of re-encoding the whole row. A step reads no journal row it already holds.
- **Durability by reason.** Tool-call status changes are durable only where a reader of the stored row needs them. Why `moved` is durable today is established first.
- **Text accumulation** is measured in bytes processed per message byte (`packages/acp/src/draft.ts`), and is made linear if it is not.

### F. Memory has budgets

- **Census.** The census names what holds the idle and the loaded server: JS heap after a full collection, by retainer through heap snapshots, plus native and allocator memory.
- **Every in-memory owner declares its bound** and evicts past it. That includes the projections of A and the caches of C, which add to the heap whose pauses froze the loop.
- **Budgets recorded here** before the work they gate: idle server memory after full collection, and server-resident memory per active agent. Target: ≤ 10 MB per active agent.
- **Lingering sessions.** Stopped ACP threads kept their runner and CLI: 31 runners and 39 CLIs held 5.8 GB at 11:50Z. Their lifetime gets a stated rule from their owner.

### G. Interface latency does not depend on agent load

- **Requirement.** Interface latency is a requirement now (see Proof). One JS heap shared with agent work cannot bound it: its pauses grow with what agent work retains.
- **The boundary is built by A and B:** a serializable, versioned change stream, and writes as messages to the writer child.
- **The split is decided by a measured gate.** If after A–F the bench misses an interface or pause gate on the reference profile, the agent runtime moves into worker isolates sharded by thread across cores. The agent runtime here is thread aggregates, harness drivers and hosted tool execution. The serving isolate keeps the doors, graph, files, settings and the thread projections, fed by the change stream. The census of F decides where each cache lives.
- **Why not split now.** That was considered. The isolate boundary depends on what the census attributes and on the residual after A–F. Both are measured here, so the gate is a number, not a deferral.

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
1. **A**, producers by ledger rank; the thread list, keep-warm and graph-copy holding move to narrow events.
2. **B**, hot units first.
3. **C, D and E**, by rank.
4. **F**.
5. **The G gate.**

## Proof

**Workload** — a testbed bench, so it is a test and not a live check:
- open-loop arrivals through the real doors: a fake runner calling `open_hosted_turn` and `call_hosted_tool` with the incident mix at 0.1 call/s per agent over a fixture repository, and a fake ACP CLI at 2.6 frames/s per agent;
- one agent in five idle on the model (beats, leases, keep-warm);
- subscribers as at the incident's longest stall: `thread.changes` ×8, `artifacts.thread` ×8, `worktrees` ×6, and `commands`, `threads`, `calls`, `views`, `graph`, `holdings`, `checkout`, `tree` ×4 each;
- also zero subscribers, and subscribe, unsubscribe, reconnect, rewind, compaction and external file changes during commits;
- N = 0, 10 and 50 at the incident rates, and a 5× rate stress run;
- 30 minutes for the steady-state runs;
- the parent's constrained 4-core / 8 GB profile as the reference profile.

**Gates on counts** (machine-independent, ledger attribution, the subscriber mix above), for a steady-state hosted `read`:
- ≤ 20 statements, reactive work included;
- ≤ 2 bookkeeping programs (call start, call end); the ACP message program counts once per assistant message boundary, separately;
- each projection recomputed at most once per key per commit batch, and zero storage reads for a change applied incrementally;
- telemetry ≤ 5% of server CPU at N = 50.

**Relative gates** (same machine, same bench): server CPU per act and allocation per act ≥ 10× below the step-0 baseline.

**Interface gates** — server-side RPC p99 at N = 50 for graph block open, thread open and thread-list update:
- ≤ 100 ms on the reference profile ([[c57e2aa9]]);
- ≤ 1.5× the N = 0 figure on the same machine.

The e2e lane's `tagma.thread-open` p99 is reported beside them: renderer cost is outside this spec.

**Loop and memory gates** at N = 50 on the reference profile, heap size reported beside each:
- loop delay p99 ≤ 20 ms, no stall over 100 ms;
- collection pause p99 ≤ 50 ms (`BUN_JSC_logGC` in the bench);
- writer wait p99 ≤ 20 ms;
- program hold p99 ≤ 5 ms;
- backlog and retained memory flat over the last 20 minutes;
- the F budgets hold.

**Correctness:**
- kill -9 between a group commit and its reply;
- a guard conflict aborts only its program and is decided again;
- durability merge and after-commit order;
- terminal start and stop recovery across their boundaries;
- ACP step-before-frames and result-after-message contracts;
- projection shadow equality under random operation sequences, rewind, compaction and restore included;
- snapshot and `attachFrom` exactness under concurrent appends: deltas applied over a snapshot equal the later snapshot;
- hydration during concurrent commits;
- refusal of undeclared writes;
- differential tests of every C owner against a fresh read, external file changes included.

## Not established

- Per-producer attribution of the reactive work (step 0 gives it).
- Collection versus paging as the stall mechanism, and the off-loop runtime work seen in some stalls.
- Why tool-call status changes are durable on ACP.
- Whether text accumulation is quadratic.
- What the 8.5 s and 16.5 s gaps without spans before and after a retained `read` call's execution were waiting on (trace `d4ba3a6c…`).
- Runner, CLI and renderer cost under load.
