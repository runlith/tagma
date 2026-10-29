---
id: 01a0e43c-d708-7c50-aaaa-0ef63295101e
title: "Draft, under review: section 3 addendum §3.13 — performance model: steps around each tool call, redundant work removed at its producer, executor protocol, budgets (v9)"
ord: 60
tags: ["idea"]
fields:
  {
    "status": "open"
  }
---
v9: answers the review of v8 (`perf-v9-contract-brief.md`). It keeps what was accepted, and closes four contracts:
1. **Executors are classified.** Pure jobs take CPU tokens under an eight-turn pattern with bounded grant distances for all four classes. Impure inspections and git keep §3.4.4's tickets.
2. **Hash sessions.** The SHA-256 state passes as a value, attempts carry ordinals, and a failure restarts from byte 0. Memory is a residency lease, and an incoherent image is unpublished, never `conflicted`.
3. **Plans.** J5 covers every block an act writes, donor and siblings included, through a projection plan validated against the touched set.
4. **Receipts.** Every C2 unit reads its canonical receipt first and writes it with all participants. `inherit_rev` covers the inherited fields at birth.

v8: answers the review of v7 (`perf-v8-contract-brief.md`). What the review confirmed is kept, and four counterexamples are closed:
1. **Capacity.** One token pool without partition. Tokens are held only by running pure work, and anyone may wait for a token, as class `held` under a hold. Traced for H = 1, 2 and 3. v7's leaf reservation, gate and shares are withdrawn.
2. **Large files.** They are hashed in chunks on a session, and `conflicted` only by comparison with basis and target.
3. **J5.** P1 writes only prepared values, with `now` and probe stamps frozen before J5, and `vocabulary_revision` in the version set. A write that was not prepared rolls back P1.
4. **Birth and folds.** `prepareBirth` and `birth` from the empty state, with the child id minted first. The fold input set includes the native `thread` columns (`context_reading`), under `fold_rev` triggers.

v7: answers the review of v6 (`perf-v7-contract-brief.md`). It keeps what the review confirmed: take-back outside the fold lane, `step-messages` as the durable witness, ready-first with requeue at the tail, W1–W10, typed attribution, continuous P1–P2, atomic P2, and the `produces` refusal.
- **J5** covers every byte input of the real codec (id, ord, verification and source stamps included) under trigger-maintained `block.proj_rev`. It adds `block.child_rev` for `ord`, and a creation precondition.
- **The leaf** is reserved only after preparation has released its job tickets, through a per-tree gate of 2, from a leaf share of the heavy slots. The disk read is async I/O, and the hash runs on the leaf.
- **External threads** keep the common journal lane, and skip only the native fold.
- **The port.** The kernel's `transition` / `control` / `prepare` / `transitionIn` port is written out, with every consumer converted and adapter obligations for SQLite, Postgres and in-memory. Section 6 is amended.

v6: answers v5's residual findings (`perf-v6-protocol-brief.md`). §3.13.7 is rewritten from a trace of the real scenarios (§3.13.7.1).
- **Take-back** writes no journal or fold input and stays outside every lane.
- **External threads** never fold. The `fold_rev` triggers are no-ops without a native row.
- **A model response** is accepted at the commit of its `step-messages` transition, which is its durable witness, and nothing claims "pending" before that.
- **Graph acts** are ready-first, with a requeue at the tail, bounded by the deadline.
- **P2's bytes** are prepared as J5 under `block.proj_rev`. Its disk check runs on a reserved leaf slot, an explicit amendment to §3.4.1.
- **Section 1's "append and projection commit together"** is restated to match the code, and the fold catch-up is prepared by the lane.
- **Remaining blocker:** the kernel's `updateAtomically` port change (§3.13.7.7).

v5: answers the review of v4 (verdict: revise) through `perf-v5-revision-brief.md`. It keeps what the reviewer accepted: T0 before preflight, flights ordered by arrival, pending `unknown` → scan, W5 in E2, `name_use` invalidation, and G1–G6. Five changes:
1. **Heavy work never falls back inline** under a writer or `Held` token. Inline runs only within a class's inline bound, which D9 must establish. Work with no prior effect refuses `stalled { none }` at its deadline, and work that settles an accepted effect stays owed to its driver.
2. **Graph jobs are narrowed** to lexical transforms of supplied bytes, versioned by a new `block.text_rev`. Name resolution, paths, frontmatter, law and permission stay in the unit. A stale act writes nothing and retries from its original queue position within its deadline.
3. **Every native fold writer is inventoried** and runs on the thread's journal lane. `thread.fold_rev` is maintained by triggers on every fold input.
4. **`produces` revalidates the whole approved subject** after permission. A change refuses `declared-subject-changed`, a new declared refusal.
5. **The stat cache is removed.** Hashing every dirty file is the normal path, and its cost is in G1.

v4: answers the third independent review, `perf-spec-review-v3.md` (verdict: revise). Its three blockers hold and are taken; what the reviewer accepted in v3 is kept unchanged.
1. **The digest cache.** It admits a file only when both `mtime` and `ctime` are older than the pass stamp by g, and its fingerprint is stable across the read. It is on only for listed local filesystem types with g = 2 s; everywhere else it is off, and its cost is reported in G1.
2. **The `produces` baseline.** It is revalidated after the permission decision. A baseline that moved refuses `declared-baseline-moved` and never runs a different act; invariant 5 is amended for declared commands.
3. **The executor model.** It is decided now as one protocol for graph transforms and native folds: snapshot, pure job with a ticket and no `Held` token, admit, validate the version set in the unit, recompute inline when stale, apply atomically. It needs a new `block.rev` and a fold head. D9 calibrates thresholds and counts only.

v3: answers the second independent review, `perf-spec-review-v2.md` (verdict: revise). All five blockers hold against the code and are taken; no new measurement was made.
1. **Digest cache.** The digest cache never caches symlinks, whose digest follows the link. Regular files use git's racy rule in the filesystem's own clock domain, and the cache fails closed where the metadata cannot be trusted.
2. **Flights.** Flights are defined as one running measurement plus one queued measurement per checkout, and the goal is stated as a bound on arrivals rather than "≤ 2". A command that declares `produces` keeps its own declared baseline: texts, HEAD, ignore check and holders, all taken before it starts.
3. **W6 invalidation.** It indexes every unresolved or ambiguous name, and re-resolves by name whenever the set of possible targets changes: a block created, deleted or restored. Acceptance compares findings and pending marks, not closure equality. v2's claimed new `edge(to_id)` index is withdrawn, because `edge_to_idx` already exists.
4. **W12 recovery.** W12 starts from an unknown state that is scanned at boot or first use, and old pending records are written before new ones. W5 moves whole into E2.
5. **Timing.** `took` starts where the door's clock starts today, before decode, beforeTool, prepare and permission. The false FIFO bound in G2 is replaced by an observable goal.

The CPU and serving-loop branch is closed as an explicit acceptance fork (§3.13.7).

v2: a redesign after the independent review `perf-spec-review-v1.md` (verdict: redesign), following `perf-redesign-v2-brief.md`. v1's mechanism is withdrawn (§3.13.12); the goal stands. v2 removes work proven unnecessary at its producer and keeps every accepted guarantee: the continuous P1–P2 hold, the atomic temp → flush → rename projection, the atomic pending-measurement marks, synchronous typed attribution, and before/after command snapshots. Targets are benchmark goals, not achieved properties. Code read at `db5591613a`; nothing in the repository or the graph was changed, and no test, typecheck, probe or load ran.

# Tagma architecture spec · Section 3 addendum · §3.13 Performance model — draft v9

**Question answered:** which work Tagma puts on an agent's critical path, which of it is necessary, and how the unnecessary part is removed without weakening what the answer promises.

**Basis:**
- Approved sections 1 [[f658e190]], 2 [[70083b67]], 3 [[511b13e3]] and 5 [[243fd181]] give the owners and words.
- The tool-overhead reading `…/01a0e3a7-557e-76ce-979f-28abbd116f4a/tool-overhead.md` and the graph-write reading `…/01a0e3bb-e634-72fd-8977-6cf2e9c87da7/edit-block-performance.txt` supply the measurements.
- The code was read at `db5591613a`.

## 3.13.1 Boundaries and invariants

Every claim in this section is stated against these boundaries. A boundary is never renamed to look shorter.

**A tool call.**

| Boundary | Meaning | Who records it |
|---|---|---|
| T0 opened | the door opened the call's clock, before decoding, `beforeTool`, prepare and the permission decision — where `AgentToolDoor.ts#inspect:596-684` opens it today | `native-harness` tool door |
| T0a admitted | decoding, `beforeTool`, prepare and permission are done. T0a − T0 is the **preflight** phase, and any wait for the operator's answer is its own sub-phase, **operator wait** | `native-harness` tool door |
| T1 body done | the tool's own work ended: the command exited, the bytes were written, the search returned | the tool |
| T2 durable | every effect the answer names is durable: typed change rows, a `produces` row, a graph act's P1 unit and P2 files | the owner of each effect |
| T3 obligations done | the `afterTool` steps the answer depends on have finished: the touch brief, the after-edit enqueue | `native-harness` |
| T4 answer available | the result is projected and appended to the run | `native-harness` |
| T5 next call ready | the native harness has every result of the step and dispatches the next model request | `native-harness` step loop |

- **`took`** is T4 − T0: the whole wait, from the clock's opening through preflight, body, obligations and projection. Today it is sampled before the `afterTool` rules run (`AgentToolDoor.ts:1084-1110`), so it ends before T3 and T4.
- **Tagma's overhead** in a call is `took` minus the tool's own work and minus operator wait. Preflight is part of that overhead.
- **The resume gap** is T5 − T4. It includes waiting for sibling tool calls of the same step and is reported separately. It is not part of any tool's overhead.

**A graph act:** P1 committed (rows, event, pending marks), then P2 durable (the act's files written by temp → flush → rename), then P3 synced (the git commit of acts). Section 2 §2.4.8 and §3.11 already decide these. **Read-your-writes** holds at P2: the answer is given after P2.

**Invariants kept by this section:**
1. **P1 through P2 of one act is one continuous hold of the tree permit (rank 420)**, as §3.11 decided. This section shortens the hold; it does not split it (§3.13.6).
2. **P2 is atomic**: temp, flush, rename and directory flush, with the three-way check against external edits (§2.4.8).
3. **Pending measurement marks are written in the act's own unit** for every block whose findings the act may change, so a read never shows a verified or measured state that the act has invalidated (`MeasureDrain.ts:83-95`, `Act.ts:299-311`).
4. **Typed attribution** (an edit's or write's change row, a declared output) is durable before the answer that says "recorded" (`WorkspaceChangeLog.ts:326-353`).
5. **A command's footprint** is measured from a before-state taken no earlier than its admission and an after-state taken no earlier than its exit. The same digest function is used on both sides.
   - For a command with `produces`, **the whole approved subject is revalidated after the permission decision**, immediately before the launch. The before-state is the prepared baseline only if the subject is unchanged; otherwise the call refuses (§3.13.4).
   - The remaining window between revalidation and the process start is today's window, and it is stated rather than closed.
6. **Section 3's no-synchronous-I/O rule on the serving isolate** stands.
7. **No heavy computation runs on the serving isolate in a unit or under a `Held` token.** No `Unit` crosses an isolate. CPU tokens are held only by running pure jobs; under a hold, only a `held` wait for the holder's own hash chunks is allowed; impure executions keep §3.4.4's tickets (§3.13.7.4). Every C2 unit reads its receipt first and writes it with all its participants (§3.13.7.5). Work before its acceptance point may refuse `none`; work after it is finished by recovery.
8. **Every journal append of any thread, and every native transition, is an entry of the thread's journal lane.** External entries skip only the native fold. A native transition commits its events, their aggregate fold and the row folds up to the new head in one unit, through the kernel's `transition` port (§3.13.7.5). Take-back, envelopes, the merge notice and birth write no journal or fold input and take no lane.

## 3.13.2 What the evidence proves, and what it does not

These are single-machine samples from one day. Nothing here is projected to percentiles at twenty agents.

| # | Proven | Not proven |
|---|---|---|
| E1 | **Graph edits of 37.6, 46.4 and 64.4 s were mostly waits on the tree permit**: 35.2, 43.3 and 61.7 s. The calls started together and were served one by one; each holder's transaction took 1.4–2.2 s. A concurrent `FreshnessGate.fresh` waited 48.4 s on the same permit. | that any single edit grows slower with the block's history: 138 update events hold 17 KB, and the write path never reads history |
| E2 | **One holder's transaction was 1.36 s, of which `Doctor.closure` took 1.045 s**, with 16,929 SQL spans under `Doctor.concerned`. | the closure's cost on other blocks or projects |
| E3 | **Full-body and shelf-sized work runs in every edit** (from code, not timed separately): see the table under §3.13.3. | how much each item costs |
| E4 | **`bash` measures the checkout before and after every command.** `ShellRun.finish` p50 ≤ 512 ms and p95 ≤ 4,096 ms over 440 completions; single cases of 10,956 ms and 9,465 ms were all checkout measurement. | how much of that is `git status` and how much is hashing |
| E5 | **`edit`/`write` tails are store transactions**: 4.9 s and 4.3 s cases, almost all in `sql.transaction`. | whether that is writer wait or unit work; they share one span |
| E6 | **`took` ends before the `afterTool` rules** (`AgentToolDoor.ts:1084-1110`). | the size of the gap: `harness.touch` returned no hours |
| E7 | **Telemetry drops records**: 4,817,276 in one incarnation. | complete per-call phase figures, which do not exist today |

## 3.13.3 Work proven unnecessary, removed at its producer

Each row names work the code does although its result is already known or unchanged, the owner that removes it, and what stays true.

| # | Work today | Why it is unnecessary | Change | Owner | Kept |
|---|---|---|---|---|---|
| W1 | `Blocks.edit` reads the whole block three or four times per edit: `observed` outside the unit, `current` inside it, `update`'s own read, and `syncSearch`'s re-read (`Blocks.ts:692,697`; `Act.ts:422-429`) | the row inside the unit is the only one that decides | one read inside the unit, passed down. The `observed` read outside the unit remains only to explain a sibling's concurrent change on refusal, and becomes a revision number rather than the body | `graph` | the refusal's explanation |
| W2 | `bodyDelta` tokenizes both whole bodies and runs Myers against the predecessor (`Blocks.ts:574`; `bodyDiff.ts:11-203`) | `edit_block` knows the exact patch: each replaced occurrence's offset, old text and new text | the event stores the edit's exact patch. `update_block` with a whole body still diffs, once | `graph` | the event format: the patch is the delta the history reader already applies |
| W3 | `syncSearch` upserts the search row on every update, even when title, body and sources are unchanged, and the FTS trigger then deletes and re-inserts the whole text (`Act.ts:422-445`; FTS migration) | nothing it indexes changed | skip when title, body and sources are unchanged. When they changed, build the projection from the row already in hand and write only if it differs | `graph` | search results |
| W4 | `syncRefs` deletes every outgoing reference and re-inserts them all (`Act.ts:479-503`) | most edits change no reference | parse the body, which is O(B) and cheap, and write the set difference only | `graph` | references |
| W5 | `MeasureDrain.persist` rewrites the whole pending set as one JSON row in every act (`MeasureDrain.ts:257-271`) | an act adds only its own marks | pending marks become rows in section 2's `measure_pending`, inserted per mark and deleted per settle. This changes the stored format, so it lands with E2's graph-chain migration, not before | `graph` | atomic marks (invariant 3) |
| W6 | `Doctor.concerned` runs **corpus-wide relations inside every act** (`Doctor.ts:682-883`): every open `dead-ref` finding of every project (`dangling`); every close event of absorption blocks with JSON parsed per row (`absorbing`); every block of the project when a seed has a `dir` source (`territory`); a non-indexable suffix join for node sources (`naming`) | each relation's affected set can be read from indexes the producer keeps, provided the indexes also cover names that are unresolved or ambiguous today | producer-kept name indexes, and invalidation whenever the set of possible targets changes (§3.13.5) | `graph` | every block whose findings the act can change gets its pending mark in the act's unit (invariant 3); the closure may be smaller than today's |
| W7 | `projectDelta` selects **all columns of every sibling on the shelf**, bodies included, for every act, and re-derives names and child counts (`GraphFileSync.ts:223-275`) | naming needs `id, uuid, title, ord, path` and the child count; nothing else of the siblings is used | select those columns only, and re-derive the shelf only when the act changed a title, an order, a parent or the membership of that shelf; a body-only edit re-derives nothing | `graph` | paths |
| W8 | `projectDelta` re-reads each written block's `path` one by one after it already has the row (`GraphFileSync.ts:306-307`) | the path is in hand after the shelf step | reuse it | `graph` | — |
| W9 | `FreshnessGate.fresh` takes the tree permit on a clean tree | decided already by §3.4.1 rule 2 (epochs) | build it early: E1's 48 s read wait was this | `graph` | freshness |
| W10 | `bash` runs its own full measurement for each command, even when several commands of one checkout are admitted together (`ShellRun.ts:257-277`; `CheckoutBaselines.ts:62-75`: concurrency disables reuse) | a measurement that **starts after** a command was admitted, and before that command starts, is a valid before-state for it. A measurement that starts after the command exited is a valid after-state for it. Commands queued while a measurement runs can therefore share the next one | measurement flights per checkout for commands without `produces`: at most one running measurement and one queued (§3.13.4) | `change-record`, with `packages/agent-tools` | invariant 5 |
| W12 | `WorkspaceChangeLog.land` lists the thread's pending-operations directory **synchronously** on every record (`WorkspaceChangeLog.ts:337`) | the directory changes only when a write fails over to it (`keepLater`, `WorkspaceChangeLog.ts:356-390`) | a per-thread state of `unknown`, `empty` or `holding`, starting at `unknown` at boot. `unknown` or `holding` triggers an async listing, and the old records are inserted **before** the new row in the same transaction, as today. `empty` is set only after they have landed, and `keepLater` sets `holding` | `change-record` | the fail-over path; the order of old records before new ones; records left on disk by a previous incarnation |
| W13 | the touch rule reads the whole file with `readFileSync` and scans the transcript per call (`touchRule.ts:30-36,69,95-96`) | decided by §3.4.2 and §3.4.5 (the tool's own text; the delivered key) | build it early | `native-harness`, `graph` | the brief (§3.6) |

**What stays proportional to the body.** An anchored edit must scan the whole body to prove the anchor is unique. It writes the whole body row, parses its references, rebuilds its search projection when the text changed, and encodes, writes, flushes and renames its whole Markdown file. That work is O(B), and it stays O(B). It is fast work, not an ideal to hide.

## 3.13.4 The command footprint

**Contract, unchanged.** The before-state is a map `path → digest` of the checkout's non-ignored dirty paths outside `.tagma`, taken after the command's admission and before it starts. The after-state is the same, taken after it exits. Moved paths are the difference. The digest is today's (`fileDigest`: SHA-256 of the raw bytes, truncated; `too-large` above 16 MiB) on both sides. It is never compared with a git object id.

**1. Measurement flights (W10), for commands without `produces`.** `change-record` keeps, per checkout, at most **one running measurement and one queued**.
- **Joining a flight for a before-state.** A command joins the *queued* measurement. When none is queued and none runs, it starts a new one at once, so a lone command pays no delay. It never joins a measurement that is already running, because that one started before the command's admission might have.
- **When the queued measurement starts.** The moment the running one ends. Every command queued by then shares it.
- **After-states.** A command that has exited joins the same way.
- **The bound this gives.** A burst of commands admitted while one measurement runs costs that measurement plus one shared measurement, not one each. Arrivals spread over time cost at most one measurement per measurement-duration of spread, plus one. Fewer is not claimed.
- Only one `git status` runs per checkout at a time.
- **HEAD.** A reading records its start instant and the checkout's HEAD. A command whose before- and after-readings name different HEADs reports the HEAD move beside its paths.

**Commands with `produces`: the whole approved subject is revalidated after permission.** Today the declared baseline is built in `prepare` (`outputs.ts#declaredOutputs:59-112`), which runs **before** the permission decision (`AgentToolDoor.ts#inspect:614-629`). A call can wait for the operator's answer while every fact that decision saw ages.

**The approved subject** is everything the permission decision and the declaration rest on, as `prepare` resolves it:
- the working directory, by real path and filesystem identity (device, inode);
- the checkout it resolves to: the toplevel's real path and identity, and the git directory;
- the command text;
- each declared output's **literal scope**, normalized, together with its real path and whether it resolves through a symlink;
- each scope's **ignore verdict**, as git gives it: `.gitignore` files, `.git/info/exclude`, `core.excludesFile` and the global excludes;
- each scope's **ownership**: whether it lies in an unowned region such as `.tagma`, and its current holders;
- HEAD;
- the dirty-state digests under the scopes, with their before-texts.

**The order:**
1. **Prepare**, before permission. It resolves the subject above and computes the **subject digest**, the digest of every item. Section 4 binds the verdict to the prepared value.
2. **Permission.** The verdict, including any wait for the operator.
3. **Revalidate**, after the verdict and immediately before the launch. Every item is resolved again the same way: real paths and identities, one `git check-ignore` over the scopes, holders, HEAD, and `git status -- <scopes>` with digests.
   - **Equal subject digest:** the prepared before-texts are the files' texts. The prepared baseline is used, and its instant is the revalidation.
   - **Any difference:** the call **refuses before running** with `declared-subject-changed`, naming each item that changed. No process starts, and nothing of the old verdict carries over. A new call is prepared and authorized on its own subject.

A changed subject never runs under the old consent. The window between revalidation and the process start is the one that exists today, and it is stated rather than closed. **Before-state and attribution truth** — typed rows and `produces` — stay distinct from **advisory shell observations**, which alone go through the recording queue.

**`declared-subject-changed` is a new refusal of the `bash` tool.** It is declared in the tool's refusal set with its code and `unblock`, which says to call again after reading what moved. Under section 4 it is a new negative arm: callers that do not know the code see an ordinary refusal with its reason and `unblock`, and no successful answer changes shape.

The after-state of a declared command may join an after-flight. The texts it records afterwards are read at recording (`outputs.ts#earlierTexts:179-204`), unchanged.

**2. Hashing is the normal, supported path.** Every measurement hashes every dirty regular file and every dirty symlink's target with today's semantics (`fileDigest`: it follows symlinks, SHA-256, `too-large` above 16 MiB; `CheckoutBaselines.ts:188-206`).
- **No metadata-based cache** that reuses a digest across passes is part of this architecture. No filesystem label or fixed granularity proves that the bytes are equal.
- **The reuse that stays** is that of an immutable reading: a flight's reading shared by the commands that joined it (§3.13.4 item 1). That is one hash per dirty file per measurement, not per command.
- **A future cross-pass cache** would need its own backend contract, justified per backend. It is not a dependency of this section.

The hashing cost is part of G1's goal and is reported per measurement: files hashed, bytes hashed, elapsed.

**3. What stays of `git status`.** `git status --porcelain -z -uall` still runs once per flight. Its cost is git's: a stat walk over tracked files through git's own index cache, plus the scan of untracked directories. That floor stays, and it is honest.

git's own accelerators, `core.untrackedCache` and the builtin `core.fsmonitor`, keep git's correctness guarantees but change repository state: an index extension, and a daemon. They are an **operator setting per project, off by default**, never set silently.

**The watcher is not used for the footprint.** No supported watch backend guarantees the cross-directory ordering or completeness that an exact window would need. The watcher stays what §3.4.1 makes it: a trigger for graph freshness.

**Cost.** Per flight: one `git status`, one `lstat` per dirty path, and hashing of the dirty bytes whose fingerprint changed. Per command: a share of the flights it joined. Unchanged dirty files cost a stat, not a read.

**Failures.**
- A failed before-measurement leaves the command's footprint **unmeasured**, as today. No later scan can rebuild an absent before-state, and none pretends to.
- A failed after-measurement is also unmeasured, with the before-state kept for diagnosis.
- `produces` claims are refused or recorded exactly as today.

**Recording.** Typed rows for declared outputs stay before the answer (invariant 4). **Shell observations** (undeclared moved paths) are advisory. They are appended to a **bounded per-checkout recording queue** and written in batches of up to 64 entries per unit, in `call` class. The queue holds at most 256 entries; an append past that waits for the drain as the caller's own work.
- **Reader barrier:** a reader of the checkout's authorship (the prepared change, `read_changes`, `read_authorship`, `heldChanged`) first drains the queue up to its admission. Its wait is bounded by 256 entries, at most four units of 64.
- **Crash:** the queue's entries are lost. They are observations, which today's contract already declares advisory ("recorded against nobody"). Permission records, transcripts and typed attribution never enter this queue.

## 3.13.5 Graph measurement: affected sets kept by the producer

**Owner:** `graph` (Doctor, findings, the measure drain). `enforcement` owns rule checks, not findings.

**Invariant 3 is kept.** The act's unit computes, and inserts as pending, every block whose findings the act can change. What changes is how that set is found: each relation reads an index kept in the same unit that changes the fact it indexes. The set may be **smaller** than today's closure, because today's corpus-wide relations mark blocks the act cannot affect. It must never omit a block the act can affect. Acceptance is stated in those terms (§3.13.11).

**Names are indexed as names, resolved or not.** A `[[name]]` in a body and a `node` source are names of 8–32 hex characters (`protocol/references.ts`). A name resolves to the one block of the project whose uuid ends with it, and it is unresolved when no block, or more than one, matches (`Sources.ts#nodeTargets:300-335`, `Act.ts#syncRefs:479-503`). Resolution therefore depends on the **current set of blocks**, and the index must follow that set.

- **Table `name_use(project_id, holder_id, name, tail, kind, target_id)`.** It has one row per distinct name a block's body or node sources use:
  - `kind` is `ref` or `node`;
  - `tail` is the name's last 8 characters;
  - `target_id` is the resolved block, or null when the name is unresolved or ambiguous.

  It is indexed on `(project_id, tail)` and on `target_id`. `syncRefs` and the node-source writer keep it in the same unit, as a set difference over the names the body or sources hold. The `ref` table remains the resolved projection readers use.
- **When the set of blocks changes** — a block created, deleted, restored, or moved into or out of the project — the act looks up `name_use` by the block's 8-character tail on the existing `block_name_idx` expression index. It re-resolves every name found against the current blocks, updates `target_id` and `ref` where the answer changed, and marks every holder whose answer changed. A name that becomes ambiguous or unambiguous is such a change. The cost is O(names sharing that tail).
- **An open `dead-ref` finding** holds the list of names it reports (`checks/refs.ts#refCandidates:37-44`, `{targets:[…]}`). Those names are `name_use` rows with a null target, or rows whose target is deleted. A block-set change that resolves or unresolves them marks the holder as above, so the finding is re-measured without scanning every open `dead-ref` finding.

| Relation (`Doctor.ts` `CHECK_RELATIONS`) | Today | After | Cost after |
|---|---|---|---|
| `below` (ancestors) | recursive CTE | unchanged | O(depth) |
| `peers` (edges) | `edge` by from and to; `edge_to_idx(to_id, kind)` already exists (`db/schema.ts:121-125`) | unchanged; v2's "new index" is withdrawn | O(edges of the concerned blocks) |
| `sharing` (same source file) | two-step select on `source.ref`, unindexed | index `source(ref, kind)` (§3.4.5) | O(blocks sharing a path) |
| `territory` (`dir` sources) | every block of the project, with the vocabulary per row, whenever a seed has a `dir` source | taken only when the act changed a `dir` source, a container role, or a parent. Then a range scan of `source(ref, kind)` over the old and new prefixes, and their containers by CTE | O(blocks under the changed prefixes and their containers) |
| `dangling` (open `dead-ref` findings) | every open `dead-ref` finding of every project, on every act | `name_use` by tail on block-set changes, as above | O(names sharing the changed block's tail) |
| `naming` (incoming `[[…]]`; node sources) | `ref(to_id)`; node sources by a suffix join over every node source | `name_use` by `target_id` for the concerned blocks, and by tail on block-set changes | O(names naming a concerned block) |
| `absorbing` (close events whose cause names a concerned block) | every close event of absorption blocks, JSON parsed | a table `absorption(by_id, block_id)`, written by the close act | O(absorptions by a concerned block) |
| `amending` (open proposals under a concerned block) | role filter per project and `parent_id IN` | unchanged | O(children of the concerned blocks) |

- **Migration.** Section 2's graph chain adds `name_use`, the `source(ref, kind)` index and `absorption` by copy-migration (§2.4.5). It fills them once from the current bodies, sources and close events, resolving every name against the current blocks. A store whose chain lacks them keeps today's queries, so a rollback reads its own format.
- **Statements per act** become a few set-based statements per relation, never one query per concerned block (E2's 16,929 spans).
- **Settling** (the drain's `prepare`/`settle` and source probes) stays after the answer, in the drain, as today.

## 3.13.6 The tree permit: shorter holds, not a new protocol

**Decision:** keep §3.11's continuous P1–P2 hold and make each hold cheaper (§3.13.3, §3.13.5). No acquire order changes.

**Why not remove the permit from P1.** P2 regenerates the act's bytes from current rows (§2.4.8). If P1(B) can commit between P1(A) and P2(A):
- P2(A) would project B's rows as A's, or raise a false conflict;
- a later P2 could overtake an earlier one before P3 captures it.

A correct replacement would need all of the following:
- an immutable, versioned projection input per act: the bytes, or the row versions they come from;
- P2 ordered per path by act sequence;
- a defined failure and recovery at every phase;
- external-edit handling against the per-act basis;
- P3 capture by act sequence.

**Why that is not needed first.**
- **The writer is already single.** P1 units serialize at the graph store's writer whatever the permit does, so a new protocol could only overlap P2's file I/O with other acts' P1.
- **Most of each hold is removable work.** E1's hold was 1.4–2.2 s, and most of it was W1–W8 plus the closure.
- **The expected hold shrinks to** one P1 unit of O(B + affected) and one atomic file write of O(B), with its flush.
- **The flush is the one cost this decision keeps paying per act.** On macOS the flush is `F_FULLFSYNC` (§2.4.11), which is typically milliseconds to tens of milliseconds on an SSD; that is not measured here.

**When the question reopens.** After W1–W9 and §3.13.5, the benchmark G2 (§3.13.8) measures permit waits under 20 concurrent writers. If the wait p95 still exceeds its goal, and the per-act flush dominates the hold, the next step is **group flush**: the holder runs the P1–P2 of the acts already queued behind it in sequence order, flushes all their temps once, renames each in order, flushes the directories once, and answers each. That keeps per-act order, failure isolation before the shared flush, and P3 capture by sequence. It is a protocol change and needs its own amendment to §2.4.8 and §3.11. It is not adopted here.

## 3.13.7 The execution protocol, traced through the real scenarios

### 3.13.7.1 Scenarios

"Unit" means one store transaction on its writer. The last column names every port called **inside a unit someone else opened**, and what it may do there. Code was read at `9fb0d559ee`.

| Scenario and today's code | Coordinator | Prepared outside any hold (input and version) | Acquisition order | One atomic write | Accepted when | Before acceptance | After acceptance | Ports inside an open unit |
|---|---|---|---|---|---|---|---|---|
| **Graph act on an existing block** (`Blocks.ts#edit/update`, `Act.ts#unit`) | `graph` | the projection **plan** for every block written (§3.13.7.3); frozen written values (`now`, probes, normalized fields); versions `block.text_rev`, `block.proj_rev`, `vocabulary_revision` and, when `ord` is involved, the parent's `child_rev` | CPU tokens only while jobs run → the hash session's residency lease → tree permit (420) → graph writer (500); under 420, `held` tokens for P2's hash chunks | P1: rows, event, `name_use`, pending marks | P1 commit | nothing written. Stale: everything is released, the act prepares again and rejoins at the tail. At the deadline: `stalled { outcome: none }` | P2 under the same hold. An I/O or hash failure after P1 goes to §2.4.8's act recovery, and the answer says "committed, projection pending" | none |
| **Graph create** (`Blocks.ts#create:633-660`) | `graph` | the uuid minted at preparation; the candidate `ord` = the parent's max child `ord` + 1 at the parent's `child_rev`; J1–J5 over the new row's inputs | as above | P1 inserts the row with the prepared uuid and `ord` | P1 commit | precondition in P1: the uuid is absent, and the parent's `child_rev` is unchanged; otherwise stale, as above | as above | none |
| **Model response** (`ThreadStreamRecorder.ts:290-310`: `step-messages`, entries, tool provisioning) | `native-harness` transition on the thread's lane (§3.13.7.5) | prepare: the fold of the snapshot suffix plus the declared events; version `(fold_rev, head)` | lane → machine writer (510) | events, prepared row folds, aggregate columns, and participants | commit, the durable witness: the exact messages under the step's event ids | memory only. Crash or stale-defect: the step is recovered as interrupted (`ThreadRunLedger`) | none needed | none |
| **Flush and step end** (`ThreadStreamRecorder.ts:430-450`) | same | same | same | events, tool outputs (`toolOutputs.commitReferenced`), usage (`accounting.usageIn`) | commit | same | same | none |
| **Signal acceptance, inbox items** (`ThreadRunInbox.ts:140-272`) | same | same | same | inbox acknowledgement, events, folds | commit | the item stays queued | — | none |
| **Run start, end, contexts, turns, interactions, settlement, compaction** (`ThreadRunStarter.ts:187-271,514`; `ThreadRunLedger.ts:409-432`; `ThreadRunContexts.ts:208,269`; `ThreadTurnRunner.ts:224-353`; `ThreadInteraction.ts:91-356`; `ThreadEffectSettlement.ts:53-65`; `ThreadCompactionRuns.ts:197-300,586`; `ThreadSignals.ts:157-171`) | same | same | same | the transition's control rows (run, interaction, checkpoint), events, folds | commit | run end not committed: `ThreadRunLedger` recovery marks the run interrupted | — | none |
| **Envelopes and inbox-only transitions** (`ThreadEnvelopes.ts:314,463,534`) | `threads`: a **control transition** that appends no events | nothing: small reads | machine writer; **no lane**, no aggregate materialization, no fold | inbox and envelope rows | commit | nothing | — | none |
| **Command take-back** (`CommandWaiters.ts#answered:69-83` → `commandNoticeTakeBack:38-48` → `ThreadAggregate.ts#retract:621-633` → `takeBackQueued:360-395`) | the kernel's control transition, which `threads` owns | nothing | machine writer only; no lane | executions' discharge (`within`), the inbox acknowledgement under the lifecycle lock; the run inbox's in-memory entry after commit; the snapshot published after commit (`:391`), never awaited in the unit | commit | nothing | — | `within(unit)`: `dischargeDelivery` and `alongside`, small rows, no journal or fold input, no wait |
| **Note or message on a native thread** (`ThreadEventDoor.ts#acceptThreadEvents:153-159`) | `threads`, as a native transition on the lane | as for a model response | lane → machine writer | events, folds | commit | `stalled { outcome: none }` at the deadline | — | none |
| **Note, message, phase on an external thread** | `threads` and `external-harnesses` | nothing: there is no native fold | **the thread's lane** (the common journal and rollout order) → machine writer; no fold preparation, no `fold_rev` validation | journal events, `thread_record` phase, delivery claim (the external phase and delivery C2) | commit | `stalled { outcome: none }` | — | none |
| **Birth, fork** (`Harness.born`; `ThreadBranch.ts:101-195`) | `threads` | `prepareBirth`: the child id minted first; the parent snapshot at `(fold_rev, head)`; the cut and the seed fold from the empty state (§3.13.7.5) | parent's lane → machine writer | the child's record, mandate and native row, the seed events and folds, `onThreadBorn` and `commit` | commit | a mismatch or cancellation leaves no child; the call re-prepares with the same child id | — | none: every participant is in the birth unit |
| **Merge notice** (`MergeNotice`, in `landing`'s unit) | `landing` | nothing | machine writer | the merge row and an inbox item | commit | — | — | `MergeNotice(unit)`: an inbox insert |
| **Rest, wake, import, repair of a thread** (`ThreadEviction.ts:107-112`; `ThreadRolloutSync.ts:373-486`) | the thread's lane | codecs as pure jobs; versions: the lane's watermarks and the rest stamp | lane → machine writer, in bounded batches (§2.4.7) | each batch with its fold rows and cursors | each batch's commit | redone from file or rows | the lane resumes from its cursor | none |
| **Freshness repair; P3 capture** (rank 420 holders, §3.11) | `graph` passes | file reads (async I/O) and parsing into rows as pure jobs, versioned by the file digests read | tokens only while jobs run → tree permit; `held`-class tokens under it for hashing | the repaired rows; P3's captured batch | commit | redone on the next epoch | — | none |

**Every rank-420 holder** — graph acts, freshness repair, P3 capture — holds no token while it waits for the permit. Under the permit it waits for nothing except `held`-class tokens for its own pure hash chunks (§3.13.7.4).

### 3.13.7.2 Rules

1. **Nothing heavy runs on the serving isolate** in a unit or under a `Held` token. Heavy means over a class's established inline bound. An unestablished bound means the class always runs its prepared path.
2. **Pure jobs** take immutable bytes and plain values and return plain values. They hold no `Unit`, service, owner handle or token, cannot call back into the server, and acquire nothing.
3. **Waits.** CPU tokens are held only by running pure jobs, which never wait. Impure executions keep §3.4.4's tickets, and none of them is awaited under a hold (§3.13.7.4). Under 420 a holder waits only for `held` tokens for its own hash chunks. A session's memory is a residency lease taken before the permit.
4. **One deadline per call.** Snapshot, jobs, queueing, application and retries all fall within §3.12's ceiling. A retry keeps its call key, its approved subject and its minted identities: event ids and a created block's uuid.
5. **Outcomes.** Work that has not reached its acceptance point may refuse `stalled { outcome: none }`. Work past it is finished by recovery and says so.

### 3.13.7.3 Graph acts and J5

**Jobs.** Each is a pure function of supplied bytes, with its version:

| Job | Input | Output | Version |
|---|---|---|---|
| J1 anchor application | body, old, new, `all` | occurrence count; next body; exact patch | `text_rev` |
| J2 name extraction | body | lexical names | `text_rev` |
| J3 search projection | title, body, source reference strings | projection text | `text_rev` |
| J4 whole-body delta | old and new body | delta | `text_rev` |
| J5 projection bytes | every byte input of `blockFrontmatterOf` and `encodeBlockFile` (`BlockFile.ts:62-83,162-188`), taken from the post-act state — the snapshot plus the act's own changes | the exact Markdown file bytes, and their SHA-256 | `proj_rev` (and `child_rev` for `ord`) |

**J5's byte inputs, all of them:**
- `id` (the uuid);
- `title`;
- `ord`;
- `tags`;
- `fields`;
- `verified_at`;
- each outgoing edge's `kind` and its target's uuid;
- each source's `kind`, `ref`, `symbol`, `fingerprint`, `probe_revision` and `verified_at`;
- the body.

The path is not an input: it is decided in the unit, and a rename moves the file.

**`block.proj_rev` covers all of them, maintained by SQLite triggers**, so no writer can miss it:
- on `block`, for an update of `uuid`, `title`, `ord`, `tags`, `fields`, `verified_at` or `body`;
- on `edge`, for an insert or delete, bumping the `from_id` block;
- on `source`, for any insert, update or delete, bumping the owning block. That covers anchoring, re-anchoring, verification (`Sources.verify`) and the measure drain's stamp writes.

An edge target's uuid never changes, so the edge row is enough.

**`block.child_rev`** is bumped on the parent by a trigger on the insert or delete of a child, or a change of a child's `parent_id` or `ord`. It versions `ord` for a create and for any reorder.

**Create.** Before any computation, the act mints the uuid, fixes its `now`, and reads the candidate `ord` (the parent's maximum child `ord` + 1) at the parent's `child_rev`. J5 runs over the new row's inputs. The **precondition in P1**: the uuid does not exist, and the parent's `child_rev` equals the snapshot's. Otherwise the create is stale and prepares again, keeping its uuid. No revision of the new row is compared, because none exists.

**The post-state contract: P1 writes only prepared values.** Every value P1 writes into J5's inputs is computed **before** J5, frozen, and written verbatim. In-unit logic may validate, resolve what J5 does not encode, or refuse. It never computes a new value for an encoded field. That makes J5's bytes the codec over exactly the row P1 leaves.
- **Timestamps.** The act chooses one `now` at preparation. It is written as `verified_at` for the block and its sources, and kept across retries, so a retry never produces a stamp that differs from its prepared one. The same `now` is recorded on the event.
- **Source readings.** `Sources.verify` already probes outside the unit (`Sources.ts:1123-1186`: `readied` before `act.unit`). The probes' fingerprints and revisions are frozen inputs to J5. In the unit, verify keeps its checks: sources unchanged since reading, and the block unchanged (`updatedAt` compare-and-set, which `proj_rev` now subsumes). It then writes the frozen stamps. A changed source refuses `moved`, as today.
- **Normalized fields.** `bornFields`, `validateFields` and the other field normalization run in preparation against the vocabulary at its `vocabulary_revision`, which joins the version set. In the unit, the law and permission checks run as today, as validations. A check that would require a different written value refuses, or re-prepares under the deadline.
- **Every write path is covered.** Edit, update, create, verify, status change, link and unlink, anchor and re-anchor, move, and the drain's stamps are all acts. Each prepares its written values and J5 the same way, and a pass's act is an act.
- **A write not prepared.** If in-unit logic finds it must write a value that is not prepared, the **whole P1 rolls back**, no row is committed, and the act re-prepares.
- **Validation in P1:** `text_rev`, `proj_rev`, `vocabulary_revision` and, where `ord` is involved, the parent's `child_rev`, all equal to the snapshot's.

**The projection plan covers every block the act writes.** An act may write several blocks. A create that takes over a source moves it from the donor, its parent, to the child (`Blocks.ts:664-675`, `sources.takeOver` and `place`). A create or move renumbers or re-shelves siblings. A link writes the `from` block. Preparation computes a **plan**: for each block the act will write, its prepared codec inputs, its J5 bytes and target digest, and the versions it read (`text_rev`, `proj_rev`, and `child_rev` where `ord` is involved). Siblings whose only change is their path get a plan entry that says "move, bytes unchanged".

**P1 writes codec inputs only through the plan.**
- Every write to a codec input in an act unit goes through the plan's write interface, which writes the prepared values verbatim.
- The `proj_rev` triggers also record each touched block in a per-unit touched set.
- **Before commit:**
  - the touched set must equal the plan's set;
  - each block's versions must have equalled its prepared ones when the unit began.
- **A missing or extra block, or a moved version,** rolls back the whole unit, and the act prepares again, keeping its `now`.

Because each written value is the prepared object, the post-write codec input of every block equals its prepared counterpart. Nothing is re-diffed, and no different artifact is written.

**Verify and moved sources.** `Sources.verify` rechecks, in the unit, that the sources are the ones it probed (`Sources.ts:1137-1155`). When they moved, the act answers `moved`, as today. It never re-uses the first fingerprints. A caller that verifies again probes afresh, and a new plan freezes the new readings. Every other act re-prepares with fresh readings, and its `now` is kept, so a retry is invalidated by a real change and never by its timestamp.

**Validation in P1.** For each planned block, an existing block's `text_rev`, `proj_rev`, the `vocabulary_revision` and, where used, the parent's `child_rev` must equal the snapshot's.
- **Equal:** P1 applies, and P2 in the same hold writes J5's bytes. They are exact because no other writer can touch the block between P1 and P2 under the continuous hold.
- **Different:** P1 writes nothing, and the act releases everything and rejoins as stale.

**Scheduling is ready-first**, and the requeue is at the tail. Stale counts are metrics.

**What is decided in the unit:** name resolution, the vocabulary and law, permission, paths, pending marks and the closure.

### 3.13.7.4 Executors, CPU tokens, hash sessions — amendments to §3.4.1 and §3.4.4

**Two kinds of execution, separately admitted, one ledger.**

| Kind | What | Waits while executing | Admission |
|---|---|---|---|
| **Pure jobs** | J1–J5, folds, codecs, answer encoding, hash chunks | none: bytes in, values out, no I/O, no locks, no callback | a **CPU token** from the pure pool, by the class pattern below |
| **Impure executions** | inspection asks (a worker that reads files and may request declared reads), Tagma's own git in passes (a process that waits on I/O, git's locks and exit), program inspections | I/O, external locks, process exit, the reader pool (710), each under its §3.12 ceiling. None waits on a `Held` token, a CPU token or a lane | an **execution ticket** under accepted §3.4.4, unchanged: its recovery reserve, the `gate` lane workers, and the tickets per phase |

**The ledger.** Both kinds draw on the heavy slots H = max(1, P − 1) of `Capacity`:
- impure executions hold at most max(1, H − 1) tickets at once;
- the rest, and every slot an impure execution is not using, serve pure jobs.

At H ≥ 2, therefore, at least one slot is always available to pure work. At H = 1, the single slot alternates, as the trace below shows.

**Unchanged from §3.4.4:**
- the memory budget M_tagma and its split;
- the children's envelopes and the recovery memory share of 0.1 × M_tagma;
- reader pools;
- file handles and watches;
- the `gate` lane;
- the execution-ticket recovery reserve for impure work.

**Replaced:** only the CPU policy for pure jobs — the single "one slot is the recovery reserve" rule — becomes the class pattern below.

**The pure-job pattern.** A fixed grant cycle of eight turns: `held, recovery, held, call, held, recovery, held, background`.
- At each turn, if the turn's class has a waiter, its FIFO head is served. Otherwise the turn goes to the highest waiting class, in the order `held` > `recovery` > `call` > `background`.
- **Maximum grant distance** for a waiting class's head: `held` 2 grants, `recovery` 4, `call` 8, `background` 8.
- A waiter at position q in its class queue is served within q × that distance.
- The bound is in grants. Its time is grants × the running jobs' declared envelopes, each job bounded by its class's input bound and its §3.12 deadline. That time is unmeasured.
- **Classes:**
  - `held`: a rank-420 holder's own hash chunk, from any number of trees, FIFO;
  - `recovery`: act recovery, intent drivers, lane recovery;
  - `call`: a call's preparation;
  - `background`: passes.
- **No executor needs recovery in order to finish.** A pure job needs nothing, and an impure execution waits only on externals under its ceiling. Recovery can therefore never be starved by a ticket that is waiting for recovery.

**Traces.** Trees A and B each have a holder that needs hash chunks. Call preparation and act recovery are also waiting.

| H | Grants, in order |
|---|---|
| 1 | A-chunk, recovery, B-chunk, call, A-chunk, recovery, B-chunk, background… When an inspection ask holds the only slot, every pure class waits for that ask's §3.12 ceiling, then the pattern resumes. Every class advances at its distance. |
| 2 | One slot serves the pattern. The other serves impure work when it has any, and otherwise the pattern's next turn. `held` and `recovery` never wait more than one full cycle. |
| 3 | Up to two impure tickets; at least one slot follows the pattern; free slots take further turns of the same cycle. |

**CPU tokens under a hold.** A pure job's token is held only while it runs, so nothing waits while holding one. A rank-420 holder may wait for a token in class `held`. That is the one amendment, and it is acyclic, because token holders never wait. Rank 420's external call becomes "none, except `held` waits for its own hash chunks". An impure ticket is never awaited under 420.

**Hash sessions.**
- **The state is a value, not worker affinity.** The platform kit provides a SHA-256 whose intermediate state is a plain value: the chaining words, the length, and the pending partial block, under 128 bytes. Each chunk job is pure: `(state_in, ordinal, bytes) → state_out`, and it can run on any worker. The digest is standard SHA-256, the same as today's.
- **Attempt identity.** The P2 fiber owns an attempt `(act id, attempt number)`. It submits chunks in ordinal order and accepts a result only for the attempt and ordinal it expects. A cancelled or superseded attempt's results are dropped. No chunk of one attempt ever continues another.
- **Failure.** A worker's death or a cancellation between chunks ends the attempt. The act, committed at P1, stays **unpublished**, and recovery opens a new attempt that reads and hashes **from byte 0**. No offset is ever resumed.
- **Memory.** A session's buffers — two chunks of 1 MiB — are a **residency lease** charged against the server's reservation (§3.4.4). The lease is taken **before** the act enters the permit's queue, which is allowed because a residency lease is never waited on by a ticket holder. All open sessions together are bounded by that charge, so an act that cannot get its lease waits for it holding nothing.
- **Coherent image.** The reader takes the file's `lstat` fingerprint `(device, inode, size, mtime_ns, ctime_ns)` before the first chunk and after the last.
  - **Equal:** the digest is taken as the file's image, and compared with basis and target, as v8 decided.
  - **Different:** the image is **incoherent**. P2 is unpublished, and recovery retries later. It is never judged `conflicted` on a mixed digest.
  - **Limit, stated as today:** an editor that rewrites a file while restoring all of those fields within one timestamp tick is not detected. No watcher and no metadata proof is claimed beyond that.

### 3.13.7.5 The kernel transition port

**The port** replaces `updateAtomically`, `updateWithLifecycleLock` and `…InTransaction` in `packages/agent`'s `ThreadStorePort`:

```ts
transition<A>(threadId: string, plan: TransitionPlan<A>, call: { key: CallKey; deadline: Deadline; class: 'call' | 'recovery' }):
  Effect<TransitionOutcome<A>, ThreadPortFailure>

type TransitionPlan<A> = {
  declared: readonly ThreadEventInput[];            // candidate events, ids minted by the caller, stable across retries
  decide(view: DecisionView, tx: TTx): Effect<Decision<A>, E>;   // small reads and conditions only
};
type Decision<A> =
  | { apply: true; participants: (tx: TTx) => Effect<void, E>; patch: ControlPatch; result: A }  // small row writes
  | { redeclare: readonly ThreadEventInput[] }      // the events must differ: roll back, prepare again
  | { refuse: A };                                  // commit nothing
type TransitionOutcome<A> = { committed: A } | { refused: A } | { stalled: 'none' };

control<A>(threadId: string, decide: (row: ControlRow, tx: TTx) => Effect<ControlDecision<A>, E>): Effect<A>  // no events, no fold
prepareBirth(parentId, childId, cut, declared): Effect<PreparedBirth>   // child id minted before; seed fold from the empty state
birth<A>(prepared: PreparedBirth, decide): Effect<TransitionOutcome<A>> // one C2 birth unit; child absent, parent version unchanged
prepare(threadId, declared): Effect<Prepared>         // for a coordinator that owns an open unit
transitionIn(tx, prepared, plan): Effect<TransitionOutcome<A>>   // inside that unit; a stale version fails the whole unit
```

**How `transition` runs:**
1. **Prepare**, outside every hold. The adapter reads a snapshot at a consistent version: `(fold_rev, head)`, every fold cursor, the seed rows, and the aggregate columns. The kernel folds the suffix and the declared events as a pure job (§3.13.7.2): the aggregate fold of today's `acceptThreadEventsIn`, the row folds, the payload rewrites and the new cursors.
2. **The lane, then the writer.** The kernel takes the thread's lane position, then the writer. It holds nothing while it waits.
3. **Decide**, in the unit. The adapter first reads the receipt for the key (below), then compares `(fold_rev, head)`, then calls `plan.decide` with the prepared aggregate and the current control rows: inbox state, run phase, interaction, permission subject. The decision is small and makes no worker or lane wait.
4. **Apply**, in the same unit, receipt included. The events are inserted, with ids idempotent by the caller's minted ids. The adapter writes the prepared row folds, payload rewrites and cursors, the aggregate columns and the control patch, and runs `participants`: tool outputs, usage, inbox acknowledgement, run phase, checkpoint rows. It all commits together.
5. **A mismatch or `redeclare`** rolls back the whole unit, so no participant is durable. The kernel prepares again outside every hold, under the same call key and deadline, and rejoins the lane's tail. A mismatch on a native thread is a defect, because every writer of a fold input is a lane entry: after one re-preparation the lane stops with a stall record. A `decide` that finds the **permission subject** changed returns `refuse`, and never proceeds under the old consent.
6. **Outcomes.** A cancellation before commit leaves nothing. A committed transition is durable, and a model response committed as `step-messages` is its own witness. A run that did not commit its end is recovered as interrupted by `ThreadRunLedger`.

**Birth and fork, prepared from empty** (`ThreadBranch.ts:101-195`). Today the fork creates the child inside the parent's lifecycle-locked unit. It cuts the parent's history and transcript, folds the seed with `acceptSealedThreadEventsIn` over an empty state, and writes it with `updateWithLifecycleLockInTransaction`. The target splits this into a preparation and one birth unit:
- **`prepareBirth(parentId, childId, cut, declared)`**, outside every hold:
  - The child id is minted **before** preparation: `fromCall.branchId` when given, otherwise a new id, and kept across retries.
  - The job snapshots the parent at `(fold_rev, head, inherit_rev)`, with its history, its transcript and every inherited field.
  - It computes the cut (`forkCut`, `sealBranchHistory`), the inherited transcript, the seed events, and the **seed fold from the empty state**: the child's row folds, cursors and aggregate columns.
- **`birth(prepared, decide)`**, one C2 birth unit on the machine writer, inside the parent's lane position:
  - **Decide:**
    - the receipt, first;
    - the parent's `(fold_rev, head, inherit_rev)` is unchanged;
    - the parent has no pending interaction;
    - no run stands other than the spawning or forking one;
    - the owner matches;
    - the child id is **absent**.
  - **Apply:** the child's record, mandate and native row; the seed events; the prepared folds; the `onThreadBorn` participants; the caller's `commit`. Every participant is in this one unit.
- **A mismatch** rolls back the unit, and `prepareBirth` runs again with the same child id, under the deadline.
- **A fork's copy** stays section 3's declared **large** unit for its SQL writes. Its folding is prepared, not inline.
- **Converted caller.** `ThreadBranch.ts:101-195` calls `prepareBirth`, then `birth`, instead of `withLifecycleLock` with `insertChild` or `insert`, `acceptSealedThreadEventsIn` and `updateWithLifecycleLockInTransaction`. `transitionIn` is never used on a row that does not exist yet.

**`control`** covers inbox-only and envelope transitions. It takes the lifecycle lock and the writer, reads no aggregate, and folds nothing: take-back, envelopes, and `ThreadRunInbox` items that append no event.

**`prepare` and `transitionIn`** are for a coordinator that must hold one C2 unit across participants. The coordinator calls `prepare` **before** opening its unit, and passes the result in. Inside, a stale version fails the coordinator's whole unit, and the coordinator prepares again. Nothing inside the unit folds or waits.

**Receipts: every C2 unit is recognized before it runs again.** The receipt reuses section 4's identity model: the canonical key `{actorRef, operation, key}` and the request digest. It is not a second receipt system.
- **For a caller's call** — a message, a note, a spawn or fork, an answer to an ask — the key is the call's key (section 4 §4.4.6).
- **For a kernel-internal transition**, the key is its stable identity. The actor is the thread, the operation is the transition's kind, and the key is its stable id:
  - the step intent's step number;
  - the flush sequence;
  - the signal id;
  - the run id with its phase;
  - the interaction id;
  - the compaction id.

  A recovery driver retrying the transition uses the same key.
- **The unit's first act.** Inside the unit, before `decide`, the adapter reads the owner's receipt row for the key:
  - **The same digest:** the stored result is returned, and no participant runs again — no usage, inbox, run phase, events or folds.
  - **A different digest:** the transition refuses `act-id-reused`.
  - **Absent:** the unit proceeds, and it writes the receipt **in the same unit as every C2 write**.
- **Unknown commit outcome, restart, lost answer.** The retry, by the caller or by the recovery driver, carries the same key, and the receipt settles it. `stalled { outcome: none }` is answered only when the receipt is absent after the unit is known not to have committed. When the outcome is unknown, the answer is `stalled { outcome: uncertain, key }` (section 3 §3.4.1), resolved by a receipt read.

**Birth, with its inherited input and receipt.**
- `prepareBirth` snapshots every parent field the child inherits:
  - `owner_id`, `agent_id`, `created_by`, `cache_group`;
  - `host_kind` and `host_id`;
  - `account`, `provider`, `model`, `reasoning`, `switches`;
  - `rights`, `authority`, `profile`, `system_prompt`;
  - the carried `bornOf`;

  and the cut (`ThreadBranch.ts:101-160`).
- A new **`thread.inherit_rev`** is bumped by triggers on every update of those columns, in the native row and in `thread_mandate`.
- **The birth unit validates:**
  - the receipt, first;
  - the parent's `(fold_rev, head, inherit_rev)`;
  - the conditional checks: no pending interaction, no foreign run, the owner;
  - the child is absent.
- **A child id present with the same receipt** returns the prior birth, with no participant run again. **A child id present without a matching receipt** refuses `birth-id-taken`. A changed grant or model moves `inherit_rev`, so it cannot pass a fresh-history check.

**Replay traces.**
- **A birth whose answer was lost.** The birth unit commits the receipt, the child, the seeds and `onThreadBorn` together, then the connection drops. The caller retries with the same call key and child id. The unit reads the receipt: same digest, so it returns the child without inserting, seeding or running `onThreadBorn`.
- **A normal transition whose answer was lost.** A flush transition commits its events, tool outputs, usage and receipt (key: flush sequence n), and the writer's answer is lost: `stalled { outcome: uncertain }`. The recorder retries with key n. The receipt answers "committed", so usage is not added twice, and the recorder continues after n.
- **After a restart.** The run's recovery reads the receipts to learn the last committed sequence. The step is resumed from there, or marked interrupted by `ThreadRunLedger`. Nothing uncommitted is claimed.

**Call-site conversion.** Every consumer changes in the same source change.

| Consumer | Today | Target |
|---|---|---|
| `ThreadStreamRecorder.ts:301` (step intent) | `updateAtomically` + `acceptThreadEventsIn` | `transition({declared: step-messages, entries, provisioning; decide: always apply; participants: none})`; the tool provisioning bookkeeping after commit |
| `ThreadStreamRecorder.ts:438` (flush, step end) | same, plus `commitReferenced` and `usageIn` in the unit | `transition` with those two as participants |
| `ThreadRunLedger.ts:409-432` (run end) | same | `transition`; `decide` checks the run is still running |
| `ThreadRunStarter.ts:187-194,514` | same | `transition`; `decide` checks that no run stands |
| `ThreadRunStarter.ts:245,271` | a patch without events | `control` |
| `ThreadRunContexts.ts:208,269` | events inside a caller's update | declared events of the enclosing `transition` |
| `ThreadTurnRunner.ts:224,274,304,353` | same | `transition` with declared question, turn and composition events |
| `ThreadInteraction.ts:91-100,198,278,341-356` | same | `transition`; `decide` checks the interaction's status |
| `ThreadEffectSettlement.ts:53-65` | same | `transition`; `decide` checks the effect is pending |
| `ThreadSignals.ts:157-171` | same | `transition`; `decide` checks the run is active |
| `ThreadCompactionRuns.ts:197-300,586` | same, with checkpoint rows | `transition` with checkpoint and pruned-call rows as participants |
| `ThreadRunInbox.ts:140-272` | `updateAtomically` over the inbox | `transition` where events are appended, `control` where they are not |
| `ThreadEnvelopes.ts:314,463,534` | inbox and envelope rows | `control` |
| `ThreadAggregate.ts#takeBackQueued:360-395` | `store.transaction` with the lifecycle lock | `control` with `within` as a participant |
| `ThreadBranch.ts:101-195` (spawn, fork) | `withLifecycleLock` + `insertChild` + `acceptSealedThreadEventsIn` + `updateWithLifecycleLockInTransaction` | `prepareBirth`, then `birth` |
| `ThreadEventDoor.ts#acceptThreadEvents:153-159` | `updateAtomically` | `transition` |
| Tagma's `ThreadStore.ts:278-545`, `InMemoryAggregateStorage.ts:32` | adapters | implement `prepare`, `transition`, `transitionIn` and `control` below |

**Adapter obligations:**
- **Tagma's SQLite adapter:**
  - the snapshot comes from a reader connection at one WAL read-transaction;
  - the `fold_rev` triggers are those of §3.13.7.6;
  - the lifecycle lock is taken inside the writer's unit;
  - the compare and apply are in that unit.
- **The in-memory adapter** keeps the same semantics, with a version counter.
- **Both adapters** pass the kernel's conformance suites extended for these cases:
  - a stale version at decide;
  - `redeclare`;
  - a refused permission subject;
  - a whole-unit rollback with no durable participant;
  - idempotent event ids on retry;
  - `control` with no fold;
  - `birth` with the child present, the parent's version changed, or `inherit_rev` moved;
  - lost-answer replay, where a committed birth or transition, retried with the same key, returns its result and runs no participant again;
  - a changed request under the same key, which refuses `act-id-reused`;
  - a child id taken without a receipt, which refuses `birth-id-taken`;
  - a `context_reading` write outside the event path invalidating a prepared fold;
  - `transitionIn` failing its coordinator's unit.

### 3.13.7.6 Native folds, and the journal lane for every thread

- **The lane.** Each thread has one journal lane, owned by `threads` (section 1). Its entries are:
  - every native transition;
  - every journal append for an external thread;
  - export, rest, wake, import and repair.

  No append can pass between a watermark, a rest deletion and an authority switch. External entries skip fold preparation and `fold_rev` validation only.
- **The native fold input set** is everything the fold reads:
  - `thread_event` rows;
  - `thread_entry`, `thread_history_item`, `thread_compaction_checkpoint`, `thread_pruned_tool_call` and `thread_cache_observation`;
  - every cursor of `thread_log`;
  - **the native `thread` columns the fold reads or the aggregate patch writes**: `context_reading`, which `foldThreadEvent` reads for cache observations and the next reading (`ThreadEventDoor.ts:161-176`), and every aggregate column `updateAtomicallyIn` may patch (`ThreadStore.ts:515-548`).
- **`thread.fold_rev`** lives in the native `thread` row, which rest keeps. Triggers maintain it for every write to that set: insert, delete and update on the tables, and updates of those `thread` columns. A writer outside the event path is therefore still counted, and none is forbidden to exist.
  - The triggers belong to each unit's declared write set.
  - Applying a prepared result bumps `fold_rev` in the same unit, **after** validation. The validated input is the snapshot's, and the new value becomes the next transition's version.
  - For an external thread, which has no native row, the triggers update nothing.
- **What the version check covers.** `(fold_rev, head)` covers the whole snapshot the preparation read, not only whether an event arrived.
- **Atomicity is kept at its accepted strength.** A committed native transition commits its events together with their aggregate fold and the row folds of the whole suffix up to the new head. Today's catch-up in the next unit (`ThreadStore.ts:509-538`) is the gap this port closes, not a weaker target.

### 3.13.7.7 Calibration and the G5 fork

D9 establishes the inline bounds, the class rotation weights, the hash chunk size, the pool's worker count and the transfer mode. It may not change the rules, the versions, the orders or the outcomes.

G5 is measured on the E0 baseline, and again after §3.13.3 and this protocol are built. A failure opens attribution, and each owner removes the cost at its producer, then the same workload runs again. The twenty-agent goal stays unaccepted until G5 holds. This document contains no evidence that it does.

### 3.13.7.8 What remains open

- **The protocol has no known open design point.** The port change and its migration are planned implementation (§3.13.13, E5).
- **Unmeasured:**
  - the inline bounds;
  - the `held` waits and the rotation weights;
  - the stale and redeclare rates;
  - the hold after W1–W9;
  - the flush cost;
  - G1–G6.

## 3.13.8 Targets and how they are measured

**The phase ledger** is the prerequisite for every figure. Each tool call and each graph operation writes one record with its boundaries (§3.13.1) as same-clock instants of the server process:
- the door's phases, the tool's own work, Tagma's in-body steps, the obligations and the projection, as **intervals**;
- the exclusive time of each phase, computed as the union of its intervals minus nested ones, so overlapping spans are never summed.

Two limits are stated with every figure:
- **Cross-process work** — the execution host's command run, a SQLite child's statement — is recorded as the server-side elapsed of the ask, with the callee's self-reported duration beside it. Their difference is labelled transport and is never called Tagma's overhead.
- **Completeness.** Ledger records go through §3.4.8's protected pending class. A window whose records were dropped is unmeasured, never partial.

**`took`** becomes T4 − T0, from the door's opening, preflight included. Preflight, operator wait and the resume gap T5 − T4 are shown beside it in `read_thread`.

**Goals.** They are goals for the benchmarks below. None of them is claimed today.
- **Before/after** goals compare the same workload on the same machine class before and after a change.
- **Scaling** goals hold a workload fixed while unrelated corpus grows.

| Id | Workload | Measured | Goal |
|---|---|---|---|
| G1 | `bash` touching 3 files; dirty set D ∈ {0, 100, 1,000} files (10 MiB); k ∈ {1, 20} concurrent commands on one checkout; with and without `produces` | T4 − T0 minus the host's command interval; measurements per burst with the arrival spread; files and bytes hashed per measurement; revalidation time for `produces` | **before/after:** measurements per burst stay within §3.13.4's arrival bound, instead of one before and one after per command. Every measurement hashes all dirty bytes, and that hashing cost is reported, not hidden. **scaling:** with D fixed, Tagma's elapsed does not grow with the number of clean tracked files beyond git's own status cost, reported beside it |
| G2 | `edit_block` of ≤ 100 characters; body B ∈ {4 KiB, 174 KiB, 1 MiB}; siblings S ∈ {5, 57, 500}; project blocks P ∈ {10³, 10⁴, 10⁵}; history V ∈ {10, 10³}; one writer, and 20 writers on distinct blocks of one tree | the P1–P2 hold; permit wait; rows read; statements | **scaling:** the hold is independent of S, P and V within 10%, and linear in B. **before/after:** at B = 174 KiB, S = 57, statements per act fall by ≥ 10× from the E0 baseline, and the hold by ≥ 5×. For twenty writers, each call's permit wait is reported next to the measured sum of the holds ahead of it, since that sum is the only bound a FIFO gives. The observable goal is that a burst of 20 such edits at B = 174 KiB drains, from the first admission to the last answer, within 20 × the single-writer hold goal plus the flushes |
| G3 | an `edit` of one hunk in a 2,000-line file; one writer and 20 | the typed-row unit's wait and hold at the machine writer; the touch brief | **before/after:** unit hold independent of the thread's history; writer wait reported by class |
| G4 | `read` of 200 lines of an anchored file | touch brief time | **scaling:** independent of the project's block count and the transcript's length |
| G5 | twenty-agent mixed load | serving-loop lag p99; loop utilization; writer wait by class p99; stalls with their attributed kind | lag p99 ≤ 50 ms, and no stall over 100 ms in the run (the level §3.4.6 treats as a problem). **Failing G5 opens §3.13.7's fork; it is not a figure to report and ship** |
| G6 | graph cold open, `read_brief`, `read_owners`, `search_blocks` page, `submit_work` without hooks (20 files, builtin rules) | the phase ledger | **before/after:** each reported, and none growing with unrelated corpus (the op-cost fixtures of §3.4.9) |

**Where a goal is absolute.** On the lowest supported machine, G2's single-writer hold at B = 174 KiB is ≤ 100 ms excluding the flush, and the flush is reported separately. This is a goal, to be confirmed on that machine class before it is ever enforced.

## 3.13.9 How it would be held — an explicit, authorized step

**The suite (design only).** `bench/perf/` holds one scenario per G row, a generator for the checkout and graph sizes above, and the E0 baseline recorded as data. A scenario reports its figures with coverage: runs, spread and dropped ledger records.

**Nothing is enabled by this section.** Running the suite, adding a rule, or scheduling it at merge or on a reference machine is a future implementation step, and each needs:
- **An owner:** `performance` for the suite; `enforcement` for a rule.
- **Evidence:**
  - a baseline recorded on the machine class the rule would judge;
  - a noise study giving each scenario's spread;
  - the operator's authorization through `enforce_rule`.
- **A rule's violation fingerprint:** the scenario, the figure, the phase that grew, and the spread. A single run past a goal is a signal to re-run, not a violation.

## 3.13.10 Owners

| Owner | Here |
|---|---|
| `native-harness` | T0–T5 boundaries, `took`, the resume gap, the phase ledger's tool phases; W13 with graph; `fold_rev`, prepared folds and every fold writer as a journal-lane entry kind; native transitions as lane entries with declared events; the `produces` subject revalidation in the tool door, with `packages/agent-tools` |
| `invocation` | the ledger's door phases for operations |
| `graph` | W1–W9; Doctor, findings and the drain; the producer-kept indexes of §3.13.5; the P1–P2 hold and its future group-flush question; `block.text_rev`, `proj_rev`, `child_rev`, the post-state contract, jobs J1–J5 and the chunked P2 disk check (§3.13.7) |
| `change-record` | measurement flights, the recording queue and its reader barrier; W12 |
| `packages/agent-tools` | `ShellRun` and `CheckoutBaselines` as the flights' clients |
| `workspace` | the watcher, for freshness only |
| `performance` | the ledger's storage and completeness; the suite; D9's loop attribution by owner and kind |
| `enforcement` | a future `performance-budgets` rule, when authorized |
| `platform` | the `Capacity` ledger every executor draws on; one token pool with class priorities; the executor kit and its pure-job contract |
| `packages/agent` | the `transition` / `control` / `prepare` / `transitionIn` port, its conformance suites, and the conversion of every kernel consumer (§3.13.7.5) |
| each producing module | its class's input set and version set, and its threshold under §3.13.7's protocol |

## 3.13.11 Acceptance criteria

These describe the implementation to come; none is met today.

1. **W1–W13 are gone,** each shown by the operation's statement count and bytes read in the op-cost fixtures, against the E0 baseline recorded at the same workload.
2. **Findings and marks are unchanged by the new indexes.** A recorded corpus of acts is replayed twice, once with today's closure and once with the indexed closure. After each act:
   - every block whose findings a full doctor sweep changes was already pending, marked in that act's unit, under the indexed closure;
   - the settled findings of both runs are equal.

   The indexed closure may mark fewer blocks. The corpus includes a block created, deleted and restored under a name that is:
   - unresolved;
   - ambiguous;
   - becoming ambiguous;
   - becoming unambiguous.
3. **Concurrent commands share flights within their bound.**
   - Twenty `bash` commands without `produces`, admitted while one measurement runs, share at most that measurement plus one before-measurement.
   - No command uses a reading that started before its own admission.
   - A command with `produces` takes its own declared baseline before it starts, with holders checked.
4. **Hashing is complete.** Every measurement hashes every dirty regular file and every dirty symlink's target, and a flight's reading is shared only by commands admitted before it started.
5. **`took` covers the whole wait.** `took` equals T4 − T0 from the ledger, measured from the door's opening. Preflight, operator wait and the resume gap are reported apart.
5b. **A changed approved subject refuses.** Each of these, happening while the call waits for permission, makes the call refuse `declared-subject-changed` with nothing run: a scope's ignore verdict changes (through `.gitignore`, `info/exclude` or the global excludes), a scope becomes a symlink, the checkout's identity changes, HEAD moves, a scope gains a holder, or a dirty path's digest changes.
5c. **The protocol holds in every traced scenario (§3.13.7.1).**
   - No unit applies a result whose version moved: `text_rev`, `proj_rev`, `child_rev`, or `(fold_rev, head)`.
   - A create whose uuid exists, or whose parent's `child_rev` moved, is stale.
   - Pure jobs and impure executions are admitted separately. The pattern serves `held` within 2 grants, `recovery` within 4, and `call` and `background` within 8, at H = 1, 2 and 3 with several trees. Under 420 only `held` tokens are awaited.
   - A file of any size is hashed from byte 0 in one attempt, with the state passed as a value. An incoherent image (the fingerprint moved during the read), a cancellation or a worker's death leaves the act unpublished for recovery, and never `conflicted`. Session memory is a charged residency lease.
   - Every block an act writes — donor, child, reordered siblings — is in the plan. A touched set that differs from the plan rolls back P1. Verify answers `moved` on changed sources, and never re-uses old fingerprints.
   - A fork is born from a prepared seed in one birth unit, validated by `(fold_rev, head, inherit_rev)`. A lost answer of a birth or a transition is replayed from its receipt, with no participant run twice.
   - A `context_reading` write invalidates a prepared fold.
   - Take-back, envelopes and the merge notice never wait on a lane.
   - An external append keeps the journal lane's order and never folds.
   - A `transition` whose version moved, or which is redeclared, rolls back every participant.
   - A changed permission subject refuses.
   - The SQLite, Postgres and in-memory adapters pass the same extended conformance suites.
5a. **Pending records survive a restart.** A typed record left in `pending-changes` by a failed store write before a restart lands before the thread's next typed row, in order.
6. **G1–G6 have figures.** Each scenario runs and reports its figures with coverage. No goal is asserted as met until its figures exist.

## 3.13.12 v1 proposals withdrawn

| v1 proposal | Why withdrawn |
|---|---|
| P1 without the tree permit | P2 regenerates from current rows; without an immutable per-act input, acts would project each other's rows (review, §3.11) |
| chunked bodies, per-chunk search and references, checkpoints, "O(delta) edits" | a chunk digest cannot find or prove the uniqueness of an arbitrary anchor; offsets shift; the checkpoint breaks the per-act write bound; history growth was refuted as a cause. Edits stay O(B + affected) |
| ranged in-place file patch with an after-write digest | breaks P2's temp → flush → rename atomicity; a length change rewrites the suffix; a mismatch gives no right to overwrite |
| watcher fences as an event-delivery barrier; footprint from watcher paths | no supported backend guarantees that ordering or completeness; a missing before-state cannot be rebuilt |
| comparing a file's SHA-256 digest with a git blob id | different hash domains |
| the Doctor closure after the answer | a read could see a verified state the act had invalidated; the closure stays in the unit, made cheap |
| "enforcement owns the doctor closure" | findings are the graph's |
| a new worker pool with a 64 KiB rule, decided now | §3.4.6 requires attribution first; every executor shares one ledger |
| absolute budgets presented as properties; merge gate and nightly machine scheduled | they are goals; enforcement is a future authorized step with evidence |
| in-memory observation queue of 4,096 entries | unbounded drain on the reader; replaced by 256 entries, batches of 64 and a bounded barrier |

**v2 proposals corrected in v3** (review `perf-spec-review-v2.md`):

| v2 proposal | Why corrected |
|---|---|
| digest cache over symlinks by `lstat` | `fileDigest` hashes the target's content, which the link's `lstat` does not see; symlinks are now always hashed |
| racy rule against `hashed_at` on the server clock | the filesystem's clock is the one the files' mtimes use; a stamp file's mtime replaces it, and the cache fails closed |
| one flight for 20 commands, ≤ 2 `git status` per burst | a flight started before later admissions cannot serve them; now one running plus one queued, bounded by arrival spread |
| flights serving `produces` commands | the declared baseline needs before-texts, HEAD and the holders check before start; it stays its own |
| `finding.target_key` and `source.target_id` | a finding names several targets, and resolution follows the current set of blocks; replaced by `name_use` with re-resolution by tail |
| a new `edge(to_id)` index | `edge_to_idx` already exists |
| "closure equals today's" | the indexed closure is deliberately smaller; acceptance compares findings and marks instead |
| W12 as a count starting at zero | records a previous incarnation left on disk would be missed; the state starts `unknown` |
| W5 in E1 | it changes the stored format; it moves to E2 |
| `took` from admission | the door's clock opens before preflight; `took` starts there |
| G2's "FIFO bound" of 20 × the hold p50 | one long holder breaks it; the only bound is the sum of the holds ahead |
| pool size as the only CPU unknown | the fold-executor contract is missing; the G5 fork is explicit |

**v3 proposals corrected in v4** (review `perf-spec-review-v3.md`):

| v3 proposal | Why corrected |
|---|---|
| cache admission by `mtime` age only | a restored `mtime` with a current `ctime` could be cached, then rewritten in the same tick; both times must be old, and the fingerprint stable across the read |
| cache "off when g cannot be established" | g is not derivable from one stamp; the cache is on only for listed local types with a fixed g = 2 s |
| the declared baseline taken in `prepare`, before permission | it can age while the operator answers; it is revalidated after the verdict, and a moved baseline refuses |
| pure graph transforms "on a worker" inside the hold; folds left to be designed | a wait on a worker under rank 420 breaks §3.4.1; the prepare, validate, inline-if-stale protocol replaces it for both |

**v4 proposals corrected in v5** (review of v4, `perf-v5-revision-brief.md`):

| v4 proposal | Why corrected |
|---|---|
| inline recomputation on a stale version, a full pool or a dead worker | it puts the heaviest work on the serving isolate under the writer, and more often under contention. v5 runs inline only within an established bound; otherwise an act with no effect retries or refuses, and an owed append stays with its driver |
| `block.rev` protecting prepared outputs | name resolution, paths, frontmatter, law and vocabulary are not covered by it. v5 prepares only lexical transforms of supplied text, versioned by `text_rev`, and decides everything else in the unit |
| the fold head (last folded sequence) as the fold version | it misses cursor moves, stripping, bounding, checkpoints and rewritten payloads. v5 uses `fold_rev`, maintained by triggers on every fold input, and orders all writers on the journal lane |
| revalidating HEAD, digests and holders | the approved subject also includes scopes, ignore verdicts, symlinks and checkout identity. v5 revalidates the whole subject |
| `declared-baseline-moved` beside "answer shape unchanged" | it is a new negative arm and is declared as one, `declared-subject-changed` |
| the stat cache on a filesystem whitelist with g = 2 s | a label and a fixed g prove no tick bound, clock behaviour or mmap visibility. Hashing is the normal path |

**v5 proposals corrected in v6:**

| v5 proposal | Why corrected |
|---|---|
| every journal writer on one lane, take-back included | take-back runs inside a unit the kernel opens, and writes no fold input. A lane wait there would deadlock with the writer, so it stays outside every lane |
| `fold_rev` in the `thread` row, with no word on external threads | external threads have no native row. The triggers are no-ops for them, and external appends never fold or validate |
| an owed model-response append that answers "pending" | no durable copy existed before its unit. Acceptance is now the commit of the `step-messages` transition, and before it the step is recovered as interrupted |
| a retry "at its original FIFO position", bounded by earlier acts | ready-first scheduling lets later acts overtake. The requeue is at the tail, and the deadline is the only bound |
| P2's assembly and hash "mostly native" in the hold | CPU under the hold is still CPU. The bytes are prepared as J5, and the disk hash runs on a reserved leaf slot |

**v6 proposals corrected in v7:**

| v6 proposal | Why corrected |
|---|---|
| J5's input without `id`, `ord` or source stamps; no create contract | the codec encodes them (`BlockFile.ts:62-83,162-188`). `proj_rev` covers all of them through triggers, `child_rev` covers `ord`, and a create has a precondition, not a revision |
| the leaf reserved at admission | it took the same slots preparation needs. It is now reserved after preparation, through a gate of 2 per tree, from a leaf share |
| external threads with no lane | the common journal and rollout order must hold for them. They take the lane and skip only the native fold |

**v8 counterexamples closed in v9:**

| Counterexample | Revised guarantee | Why it no longer holds |
|---|---|---|
| inspections and git called "pure"; no minimum for `recovery` while `held` is non-empty | pure jobs versus impure executions, admitted separately; impure work holds at most max(1, H − 1) slots; the eight-turn pattern gives `held` ≤ 2 grants, `recovery` ≤ 4, `call` and `background` ≤ 8 | every class has a finite distance in grants at H = 1, 2 and 3, with several trees. No executor waits for recovery, and the memory, child and reader reserves are unchanged |
| a token per chunk with no session identity; a lost SHA state resumed on another worker; memory per session only; a mixed image read as a conflict | the state as a value, attempts with ordinals, results of a dead attempt dropped, a restart from byte 0; buffers as a residency lease within the server's charge; `lstat` fingerprints before and after, and an incoherent image unpublished | no chunk continues another attempt's state, memory is bounded across all sessions, and `conflicted` needs a coherent image |
| J5 only for the named block; a donor's source moved outside the plan | a projection plan for every block written, and a touched set equal to the plan before commit; verify answers `moved` and never re-uses fingerprints | a missing or extra block rolls back P1, and every written block's bytes are prepared |
| inherited parent fields unchecked; a lost birth answer seen as "child absent"; participants re-run on replay | `inherit_rev` in the birth's version set; a receipt read first and written with every C2 write; `birth-id-taken` for a foreign collision | a changed grant or model is stale, and a replay returns the prior result with no participant run again (traces in §3.13.7.5) |

**v7 counterexamples closed in v8:**

| Counterexample | Revised guarantee | Why it no longer holds |
|---|---|---|
| leaf share and recovery reserve exceed H at H = 1, and leave no job capacity at H = 2; a reservation held while waiting | one pool of H tokens; a token is held only while pure work runs; waiting for a token is allowed under a hold, in class `held` | no token is ever idle or partitioned, so every H ≥ 1 makes progress (§3.13.7.4 trace), and a token wait cannot close a cycle because holders never wait |
| a file over 2 MiB treated as a conflict | a complete chunked hash on a session, with memory of two chunks; `conflicted` only if the digest differs from both basis and target | size no longer decides; failure to finish leaves the act committed and its P2 recoverable |
| verify's `now` and stamps chosen inside P1, differing from J5 | P1 writes only prepared values; `now` and probes are frozen before J5; `vocabulary_revision` is validated; an unprepared write rolls back P1 | the row P1 leaves is exactly J5's input, and a retry keeps its `now`, so it cannot loop on a new timestamp |
| a fork's child seeded inside the birth unit; `transitionIn` on a missing row; `context_reading` outside `fold_rev` | `prepareBirth` and `birth` with the child id minted first, the seed folded from the empty state, and the child absent in the unit; `fold_rev` triggers on the fold-read `thread` columns | the birth prepares without a row, and any write to a fold input, `context_reading` included, moves the version |
| the port change left to section 6 | the port, every consumer's conversion and the adapter obligations are specified in §3.13.7.5, and section 6 is amended |

## 3.13.13 Build order

1. **E0 (with section 3's E0).**
   - The phase ledger with protected pending records; `took` at T4; the resume gap.
   - The recorded baselines of G1–G6 at today's code.
2. **E1 (`graph`).** W1–W4, W7 and W8, which change no stored format, and W9 (§3.4.1 epochs).
3. **E2 (`graph`, with section 2's graph chain).** `name_use`, the `source(ref, kind)` index and the `absorption` table of §3.13.5; W6; W5 whole (`measure_pending` rows replacing the JSON pending set).
4. **E3 (`change-record`, `packages/agent-tools`).** Flights and the recording queue; W12.
5. **E4 (`native-harness`, `graph`).** W13, as §3.4.2 and §3.4.5 already decided. The declared-baseline revalidation.
5a. **E5 (`platform`, `graph`, `native-harness`, `threads`, `agent`).** One source change covers:
   - the executor kit: pure jobs under the eight-turn pattern, impure executions under §3.4.4's tickets, and hash sessions with the state passed as a value;
   - receipts in every owner store, and `inherit_rev`;
   - `block.text_rev`, `block.proj_rev` and `block.child_rev`, with their triggers, in E2's graph-chain migration; J1–J5;
   - the kernel port (`transition`, `control`, `prepare`, `transitionIn`) with every consumer of §3.13.7.5, Tagma's and the in-memory adapter, and the extended conformance suites;
   - `thread.fold_rev` and its triggers, in Tagma's machine chain (§6.4.1);
   - every journal append of every thread through the lane;
   - inline bounds start unestablished.
6. **Then:**
   - re-measure G2's permit wait, and open the group-flush question only if §3.13.6's condition holds;
   - measure G5 and follow §3.13.7's fork: D9 attribution, removal at the producer or a lower class threshold, the same workload rerun;
   - any enforcement step follows §3.13.9.

## 3.13.14 The remaining questions of rule [[8dab19b6]]

1–9 are §§3.13.1–3.13.13.

10. **Contract.** No successful answer changes shape. `took` changes meaning, to the whole wait, and `read_thread` adds the resume gap. `bash` gains one **new declared refusal**, `declared-subject-changed`: a new negative arm under section 4, carrying a code and an `unblock`. Graph acts and journal appends may answer `stalled { outcome: none }` at an exhausted deadline, which section 3 already defines. A model step or run that did not commit is recovered as interrupted, as today. A graph act whose P2 failed after P1 answers "committed, projection pending". The kernel's `ThreadStorePort` changes shape (§3.13.7.5): an internal port, changed in one source change with all its consumers.
11. **Stored data.**
    - The graph chain adds `name_use`, the index `source(ref, kind)`, `absorption`, and `measure_pending` rows, by copy-migration with rollback to the old format (§2.4.5, §2.10).
    - Events of `edit_block` store the exact patch, in the delta format history already reads.
    - The recording queue is memory.
    - `block.text_rev`, `block.proj_rev` and `block.child_rev` (integers, starting at 0 at migration) join the graph chain, with their triggers.
    - `thread.fold_rev` joins `native-harness`'s `thread` row, which rest keeps. SQLite triggers on `thread_event`, the fold tables and `thread_log` maintain it. It starts at 0 at migration.
12. **Who may do what.** No rule or gate is enabled. The flights are internal. The git accelerators are an operator setting. A changed `produces` subject needs a new call and a new authorization.
13. **Long-lived things.** The recording queue is drained within four units. Flights end with their measurement. A lane entry lives until its unit commits or its deadline passes. Tokens live only while their pure work runs.
14. **Bounded resources.**
    - The recording queue is bounded at 256 entries.
    - Flights are one per checkout at a time.
    - Pure jobs: the eight-turn pattern over the slots impure work leaves, with impure work holding at most max(1, H − 1) slots.
    - Hash sessions: one residency lease of 2 MiB each, all within the server's reservation.
    - The memory of a P2 disk check is two chunks of 1 MiB, whatever the file's size.
    - Graph acts cost O(B + affected). A queued act waits for the sum of the holds ahead of it.
15. **Rollout.** Running threads see the same answers, faster. `took` becomes longer and truthful.
16. **Failures.**
    - A failed measurement leaves the footprint unmeasured, as today.
    - A crash loses only queued observations.
    - An index missing after a rollback falls back to today's queries.
    - A stale graph act or fold writes nothing; the act retries under its deadline, and a lane stops on a writer from outside it.
    - A restart leaves the thread's `pending-changes` state `unknown`. The first record scans the directory and lands the old records first.
    - A failing G5 leaves the E-step open (§3.13.7).
17. **Observability.**
    - The phase ledger.
    - Flight joins, files and bytes hashed per measurement, and recording-queue depth and barrier waits.
    - Stale validations per class, retries per act, lane stops, and token waits by class.
    - Closure statements per act, and permit wait with the hold beside it.

## 3.13.15 Amendments to approved sections

- **Section 2 [[70083b67]].**
  - The graph chain gains the table `name_use(project_id, holder_id, name, tail, kind, target_id)`, the index `source(ref, kind)` and the table `absorption(by_id, block_id)`, all owned by `graph`.
  - A block created, deleted or restored re-resolves the `name_use` rows that share its tail, in its own unit.
  - `measure_pending` holds one row per mark, replacing the JSON `meta` row.
  - `edit_block`'s event stores the edit's exact patch.
  - `block.text_rev` joins the graph chain. It is incremented by every act unit that changes a block's title, its body or its source reference strings.
  - `block.proj_rev` is maintained by triggers on `block` (`uuid`, `title`, `ord`, `tags`, `fields`, `verified_at`, `body`), `edge` (insert and delete, bumping `from_id`) and `source` (every write, bumping the owner). That covers verification and the drain's stamps.
  - `block.child_rev` is maintained by triggers on a child's insert, delete, `parent_id` or `ord`.
  - The native `thread` row gains `inherit_rev`, kept by triggers on the inherited columns of the row and of `thread_mandate`.
  - Every owner store gains the **receipt** row of section 4's canonical key: actor ref, operation, key, request digest, result. It is written in the same unit as every C2 write, for calls and for kernel-internal transitions alike.
  - The native `thread` row gains `fold_rev`, kept by triggers on `thread_event`, every fold table, `thread_log`, and the native `thread` columns the fold reads or patches (`context_reading` among them). The triggers are part of each unit's declared write set, and they are no-ops for an external thread.
- **Section 1 [[f658e190]].**
  - `threads`' per-thread journal lane carries every journal append of **every** thread — native transitions and external appends alike — together with export, rest, wake, repair and import. External entries skip only the native fold and its validation.
  - A native transition commits its events, their aggregate fold and the row folds up to the new head in one unit, through the kernel's `transition` port, and `Harness.folded` receives the prepared fold.
  - Take-back, envelopes, `MergeNotice` and birth write no journal or fold input and are not lane entries. Snapshot publication after their commit is queued, never awaited from their unit.
- **Section 3 [[511b13e3]].**
  - §3.4.1 is **amended**:
    - a CPU token is held **only** while a pure job runs; impure executions keep §3.4.1's execution tickets;
    - a fiber **may wait for a token while holding a `Held` token**, in class `held`, because token holders never wait;
    - rank 420's external call becomes "none, except `held`-class token waits for its own pure hash chunks".
  - §3.4.4's heavy slots serve two kinds. Impure executions (inspections, git in passes) keep their tickets, their recovery reserve and their gate lane, at most max(1, H − 1) at once. Pure jobs are served by the eight-turn pattern `held, recovery, held, call, held, recovery, held, background`. That replaces only the CPU rule "one slot is the recovery reserve" for pure jobs. The memory, child, reader, handle and recovery-memory reservations are unchanged.
  - §3.4.6's "workers holding heavy slots" becomes §3.13.7's protocol, and D9 establishes its inline bounds and worker count only.
  - Ranks 240/241 (the thread flush window and snapshot lane) become entry kinds of the thread's journal lane. The lane's fiber holds no `Held` token while a job runs, and takes the writer only to apply.
  - §3.12's per-call deadline covers the snapshot, the jobs, queueing, application and retries. A stale graph act rejoins the tree permit's FIFO at the tail, ready-first.
  - §3.4.5 gains W1–W8 and the producer-kept closure indexes as rows of its cost-locality table.
  - §3.4.8 gains the phase ledger and the T0–T5 boundaries.
  - `took` is defined as T4 − T0.
  - §3.5 adds the measurement flights and the recording queue to `change-record`.
  - §3.4.6 and §3.11 are unchanged.
- **Section 6.**
  - `packages/agent`'s `ThreadStorePort` replaces `updateAtomically`, `updateWithLifecycleLock` and `…InTransaction` with `transition`, `control`, `prepare` and `transitionIn` (§3.13.7.5).
  - Every kernel consumer — Tagma and the workflow members — changes with the port in **one source change**.
  - The kernel's conformance suites gain the cases of §3.13.7.5 — lost-answer replay, a changed request, birth with `inherit_rev` — and Tagma's SQLite adapter and the in-memory adapter pass them in the single C2 unit.
  - The persisted forms change only with a version and decoder, or with migrations in both chains in the same commit (§6.4.1): `fold_rev` and its triggers, and the event ids made idempotent by the caller.
- **No amendment to section 5.** The words used here are its words.
