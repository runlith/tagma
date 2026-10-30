---
id: 01a16e28-ea5b-7d70-88d6-724111d3eaf4
title: "Tagma's own cost grows with change, not with repository, agents and subscribers: checkout status by mark reason, less SQL per act, then in-process SQLite, memory and window; native rewrite rejected"
ord: 153
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a102d2-6e2d-7e57-bd22-6df0337a9d39
  - kind: relates
    to: 01a10323-2fc7-78fa-8d6d-620a6ce62961
  - kind: relates
    to: 01a13662-e32c-7bec-9643-6acc19d1811a
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c14b093139
  - kind: relates
    to: 01a16ac4-44bf-7e0a-8178-b702168725a4
  - kind: relates
    to: 01a16bfa-f686-763e-8177-968fc46fbf55
  - kind: relates
    to: 01a16c8d-16cd-71b0-bf80-15dfafa44677
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/comparison.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
  - kind: file
    ref: packages/git/src/status.ts
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
---
Tagma's own cost — the CPU, memory and processes it spends beyond the agents' own work — should grow with what changed. It should not grow with repository size, agent and subscriber counts, or history length. Today it grows with many of these axes.

This spec names what costs and why, compares paths, and proposes a work order. Rewriting the server natively was considered and rejected: the measured spend is mostly algorithmic. Native components wait for a measurement showing the remainder is bound by the cost of one operation rather than their count.

## Measurement

One sample: 2026-10-24, 13:06–13:45Z, Apple M2 Max (12 cores, 32 GB), about 40 agents in runlith (31k files in the index, local `main` 3110 commits ahead of `origin/main`). Sources: `read_machine_load`, vitals, `read_performance` metrics and overview, two server CPU profiles (`3f3878d1…`, `4a0bb8cc…`), a `ps` process sample and git trace2. One machine, one repository, one load: the numbers give shares and orders of magnitude, not a norm.

Tagma took 53% of the machine (≈6.4 cores). Of it ≈1.4 cores are the agents' own commands (execution host holder children) — not Tagma's cost. The own cost is ≈5.0 cores:

| Item | Cores | Share | What's inside |
|---|---|---:|---|
| server git children | ≈1.8 | ≈35% | `git status` over runlith 2.7/s; full `-uall` ≈0.8/s at ≈0.9 s CPU; git total ≈22 runs/s |
| server JS, all threads | ≈1.4 | ≈28% | main-thread self: Effect runtime 37–40%, drizzle 12–16%, Effect Schema ≈8.5%, sqlite-process client ≈8%, `spawn` 3–4%, telemetry ≈4%; GC and worker-thread shares unmeasured |
| window (renderer + GPU) | ≈0.85 | ≈17% | not profiled |
| SQLite children | ≈0.47 | ≈9% | 17 processes; some reader processes live minutes and restart |
| execution host | ≈0.3 | ≈6% | |

Profiles are read by self time, native frames attributed to the calling JS. The sqlite-process `ipc` entry point stands at 43–48% of samples. That is product code continued on the SQLite response stack, not channel cost: the earlier "71.5% on the SQLite path" conclusion in tests was wrong on the same grounds.

**Volumes.** Agents made ≈1.95 tool calls per second, i.e. ≈2.6 CPU-s of Tagma's own cost per call. Each call carried ≈370 SQL statements, ≈11 git runs and ≈1.4 `git status`. One bash call's own trace is 137 statements and 7 transactions. That is a separate observation: the gap to ≈370 is not necessarily background, the tool mix is not separated.

Over the 12–13Z hour there were 1.40M statements and 37.5k writing transactions. Mean writer wait is 435 ms (`Store.permit.wait`), mean transaction body 22 ms (`Store.execute`; COMMIT measured separately, 2.5 ms). The wait stands on the agent-stream write path: `ThreadStreamRecorder.flush` — 413 ms, `writeIntent` — 660 ms on average.

**Relations between windows.** From the 12–13Z hour to 13:00–13:20Z, tool calls grew 1.6x (1.2 → 1.95/s), statements 1.9x (388 → 723/s), `git status` 3x (0.9 → 2.7/s). That is a change of relations between two windows, not a scaling law.

**Idle.** In quiet hours the server took 0.11–0.15 cores (vitals 06:26Z and 10:26Z). Candidates from [[c46fbf55]] are not separated by measurement. Telemetry itself wakes the process ≈140 times a second: a stall pulse every 25 ms and a loop-latency histogram at 10 ms resolution. For a laptop that is battery cost even when CPU is small.

**Start** (from [[c46fbf55]], under foreign load): import 0.9–2.1 CPU-s, runtime assembly 2.1–9.2 CPU-s, about 2000 modules at import and 1270 lazily.

**Memory.** Server RSS:
- 1.6 GB 5 min after start;
- 3.5 GB in quiet hours, heap 0.8–0.9 GB;
- 5.9–6.8 GB under morning load;
- 8–11 GB at 13:20–13:30Z, peak 13.3 GB, committed 14.8 GB.

The heap walks 1.5 → 4.4 GB within a minute and back after collection, external 1 → 2.8 GB. Heavy allocation turnover is observed. Whether the current process leaks and who holds its RSS is not established. The heap-flat censuses from [[19d1811a]] belong to another process.

## Why it costs

**1. Checkout status is re-read whole, in the most expensive way** (verified against code and trace2):
- **`-uall` mode walks past the untracked cache.** The checkout row reads `git status --untracked-files=all`. Git 2.50.1 uses the cache with `-uall` only when `status.showUntrackedFiles=all` is configured the same way (`dir.c`). Otherwise every call walks the tree: on runlith `read_directory` visits 37.7k paths. Agents' and IDEs' plain `git status` writes the cache in `normal` mode, and Tagma's read does not use it — including the cache Tagma itself proposes enabling ([[4b093139]]). Measured: `-uall` — 0.91 s CPU, `-unormal` — 0.31 s.
- **Ahead/behind on every call.** `statusAt` in kit always passes `--branch`, and git counts ahead/behind every time. On runlith that walks 3110 commits, 149 ms per call; with `--no-ahead-behind` the print phase takes 0.5 ms. Every call pays, holdings probes included. `refreshBranch` computes the same separately via `%(upstream:track)`.
- **Full re-read on every mark without paths.** A `.git/index` or `config` change, an explicit `refresh`, an unnamed watcher event and a genuine HEAD change all lead to a full `-uall` (`rows.ts`, `comparison.ts`). Ref movement with unchanged HEAD and branch reads only metadata. Forty agents in one checkout change the index and HEAD every few seconds, hence ≈0.8 full reads/s. Causes on the saved slow reads — `index …`, `head refs`, `refresh`, `tree`, 1.1–1.5 s wall each.
- **HEAD-vs-index comparison.** `unpack_trees` takes 50–105 ms in every status, even scoped: the index cache-tree is invalid. Why is not established.

**2. SQL: many statements per act, each costly.**
- **Volume.** Slowly changing state is re-read: settings, projects, roots and their coverage, mandate lines, environments. Frequencies over the 12–13Z hour: `FileRoots.probe` 24/s, `ProviderAccounts.of` 10/s, `WorktreeFeed.thread` 6.9/s, `Settings.layers` 3.5/s, `ThreadSnapshots.publish` 3.3/s. Who contributes how many statements cannot be separated without per-unit counters.
- **One statement's cost** is ≈1 ms CPU across two processes: 0.47 child cores and ≈0.3–0.4 main-thread cores at 723 statements/s. A statement's path:
  - drizzle builds SQL anew on every call;
  - an Effect chain and a span wrap it;
  - rows travel to the child and back by structured clone;
  - after every write the child runs `wal_checkpoint(NOOP)`;
  - Effect Schema decodes the row, and `JSON.parse` the JSON columns.
- **Writer wait of 435 ms** against a 22 ms transaction body. Hypothesis — round trips to the child process stretch the hold. Unproven: code already records the engine/queue/outside-SQLite split by opKind, but it was not read here.

**3. Effect runtime** — 37–40% of the main thread. Not a separate cause but interpreter cost per unit of work: it falls together with statement, feed-frame and git volume. Worth removing separately only in hot kits (the statement chain in `connection.ts`).

**4. Feeds grow with subscriber count.** A stream-feed frame and a stream-list frame build their own basis per subscriber (`threads/list/feeds.ts`, `frameBasis`). That is its own axis — open windows and subscription counts — apart from tool-call counts. The worktree feed snapshot is already shared across windows.

**5. Memory.** 30–50 MB/s turnover and allocator retention. Producers unmeasured ([[19d1811a]]). Candidates: SQL strings over IPC (a copy at every hop), stream-event JSON bodies, per-subscriber feed frames. On an 8–16 GB machine, Tagma at 8–11 GB RSS pushes out everything else.

**6. Window.** Renderer and GPU take ≈0.85 cores under load. Over a day the GPU process accumulated more CPU than the renderer (≈0.17 vs ≈0.11 cores on average): looks like continuous repaint. That is a conclusion, not a measurement.
## Paths and choice

**Rewriting the server natively — rejected.** It would remove the Effect interpreter, drizzle SQL building and IPC. This sample gives no upper bound on the win: GC and worker shares and the child-CPU engine/transport split are unknown. But full status re-reads, hundreds of statements per act, per-subscriber frames, memory turnover and the window would stay until reworked separately — the same work as without rewriting. Cost — the whole server, re-verification of all behavior and law, loss of Effect's structured concurrency. No measurement puts rewriting ahead of algorithmic fixes.

**Git.**
- **Fix the producer — chosen.**
  - `--no-ahead-behind` in kit. Ahead/behind is computed once per key (HEAD, upstream) and again only when the repository's shallow, replace or graft data changes: `fetch --unshallow` changes reachability without moving refs. `refreshBranch` moves to the same computation.
  - A cache-compatible untracked mode, plus exact expansion of folded untracked directories: `ls-files --others --exclude-standard -- <directories>`.
  - Each mark gets re-read volume for its own reason. An index or HEAD change recomputes the staged side (HEAD ↔ index) whole with one `diff-index --cached` under the same renames setting as status — no untracked walk, no ahead/behind. Then rename and copy, all-stage conflicts and intent-to-add remain one whole git computation. Worktree ↔ index and untracked are read by named paths. Full reads remain for unnamed events and overflow.
  - The staged side must not be narrowed by path difference. Pathspec applies before rename detection: if staged deletion `a` is followed by adding `b` with its content, scoped status over `b` shows an addition and leaves `a`'s deletion instead of `a → b`.
  - Small-to-medium work, architecture unchanged. Estimate — git children ≈1.8 → ≈0.5 cores under the same load. That is arithmetic on measured call cost, not a measurement.
- **Own incremental status over an fsmonitor daemon** ([[6ce62961]]) — next step if status stays a visible share after the first.
- **Native reader (gitoxide) — deferred.** Accelerated untracked-cache traversal is unimplemented in gix (`crate-status.md`, gix-dir); no fsmonitor support was found in sources. Status semantics — attributes and filters for racy entries, autocrlf, sparse/split index, submodules, worktrees, includes — would have to be proven anew on every OS. It would remove process-spawn cost; its share is unmeasured.
- **libgit2 — no:** also without fsmonitor and untracked cache. Git has no standing status process: only `cat-file --batch` does batch mode, and it is already used.

**SQL.**
- **Cut statements per act at the producers — chosen first for SQL.**
  - Hot slowly changing state in SQLite is held by its owner as an in-memory projection. It updates after COMMIT — its own and any other's, cascade and restore included — through the existing units/moves path (`platform/store/transaction.ts`). That is an owner cache, permitted by [[51c66cb6]].
  - Only the server opens the machine base: it holds the catalog lock; offline migrate and restore take the same lock.
  - File facts with external writers never become projections. CLI-creditor credentials are re-read on every request by contract ([[1cfa3cd9]]), while `CredentialFile.read` already caches decode by stamps.
  - N+1 turns into set reads, one call's root probes into one batch.
  - Step 0 sets the target by producer rank. Landmark — tens, not hundreds of statements per typical call.
- **Prepared statements — in the same places.** Drizzle 1.0.0-rc.5 Effect builders (select, query, insert, update, delete) support `.prepare()` with placeholders: SQL and mapper build once. That removes drizzle's share where the query stays.
- **SQLite in-process — decided on the remainder after the first two.**
  - The point/bulk mark today is the caller's declaration, defaulting any read to point (`units.ts`). A stream list, for example, reads all of the project's standings without limit. So only a read with audit-proven boundedness ([[7a910861]]) may go synchronously onto the loop.
  - Safe first variant: only provably bounded point reads move into the process; writer and bulk stay in processes.
  - Channel guarantees — cancelling a long statement with reader removal, Close, handover and process loss — inline hosting does not repeat today ([[a6950a0e]]). A worker variant must keep and prove them.
  - Win: fewer processes and less memory per user (child count depends on store count and the machine's reader ceiling, [[337a9d39]]), no IPC for point reads. Cost — isolation: a reader-process crash is survived today; in-process it is not.
- **Another IPC format** (msgpack, columns) — rejected: processes stay, the win is partial.
- **Native SQLite layer** (N-API, thread pool, columnar rows) — deferred. Lowest per-statement cost and most work; isolation as in-process.

**Feeds.** A frame's basis is computed once per frame and dealt to subscribers; a subscriber differs only by window.

**Memory.** First name turnover producers by allocation measurement on one's own `tagma:try` and remove turnover at them ([[19d1811a]]). Then check whether the allocator returns memory after the fall.

**Window.** Renderer and GPU profiles under reproduced load; fix at the owners.

**Start and idle.** Lazy layers per [[c46fbf55]]. Telemetry pulses rarer or event-driven; verified by measuring stop cost. Bytecode cache of the installed bundle — a candidate, unmeasured.

## Plan in order

0. **Tooling and stand, no behavior change.**
   - Every unit span gets counters: statements, git runs by verb with CPU from rusage after reap, IPC bytes, feed frames. Overview ranks producers by them.
   - The `Store.*` split by opKind into engine, queue and outside-SQLite time.
   - A stand on `tagma:try` with separated axes:
     - agents N = 0 (idle), 1, 10, 40;
     - repository size: a project without code or git, runlith-sized, 100k files;
     - thread-history length;
     - subscriber (window) count;
     - project count;
     - machine: 12 cores / 32 GB and limited to 4 cores / 8 GB.

     Each run of a recorded call mix (read, grep, edit, bash, submit_work) reports: own-cost CPU-s per call by process (server, git, SQLite, host, window), start, idle and wakeups per second, RSS p50 and peak, allocation volume, p99 loop, writer wait — with and without telemetry.
   - Budgets: statements per tool call, git runs per operation, statuses per HEAD move — itest checks, like the [[afa44677]] inventory.
1. **Checkout status by mark reason** — Git kit (adeeb4ba), work places (06405a5f), Holdings (00ddf0e5).
2. **SQL per act** — producers by step-0 rank: owner projections, batched probes, prepared statements. With it — frame basis once per frame. For the agent path (hosted tool calls, ACP steps, thread projections, the writer, memory and the interface's fault domain) this step is specified by [[2afe6fec]].
3. **SQLite in-process** — if step 2 leaves the SQL path a visible share. First an audit of point-read boundedness; the decision is recorded with a number.
4. **Memory turnover** — [[19d1811a]].
5. **Window, start and idle.**

Return-to-native-component thresholds are set by the step-0 stand across all axes, weak machine included. Return — if after steps 1–3 git-spawn or single-statement cost stays the own cost's main item.

## How it is proven

- **True to life.**
  - Git: the new status read is compared against `git status --porcelain=v2 -uall --branch` over a corpus of repository states in CI on macOS, Linux and Windows. Corpus: staged rename and copy across the named-path boundary, conflict over all stages, intent-to-add, nested repository, submodule, ignored directory, sparse checkout, worktree, CRLF and attributes, symlink, case-only rename, shallow and `--unshallow`, fsmonitor and untracked cache on and off.
  - The incremental path — with random operation sequences: after each, the mark-reasoned read equals the full one.
  - Owner projections — by differential test: the projection's answer equals a fresh read after random writes, cascade and restore included.
  - SQLite in-process — with the channel conformance set on both hostings, extended with cancel, Close, handover and loss.
- **Before and after under one load** — the step-0 stand across axes: cold and warm, at least three runs in a quiet window. After an operator server restart — live `Git.status`/`agent.tool-call` and `sql.execute`/`agent.tool-call` ratios, `Store.permit.wait`, server and child CPU.
- **Budget against regression** — step-0 counters in every affected operation's itest.

## Unmeasured

- GC and worker-thread shares of server CPU.
- Window profile.
- SQLite-child CPU split into engine and transport.
- The writer-wait cause.
- Statement attribution by producer — step 0 gives it.
- Cost on a weak machine, in a codeless project, under long history and many subscribers.

All of the above is one machine, one repository, one load. A user with a smaller repository and a couple of agents pays less but by the same formulas: a full status per index change, ahead/behind per call, hundreds of statements per act, a frame per subscriber.

Estimate after steps 1–2 under the same load — ≈2.5–3 cores instead of ≈5. That is arithmetic, not a measurement; the step-0 stand verifies it.
