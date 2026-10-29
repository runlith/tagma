---
id: 01a0e55d-7385-7116-a91b-a9a5e4f76910
title: "Kernel ports Threads, ThreadRuns, ContextCompaction, ThreadModel, ThreadBudget and ThreadTypes: members"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/collaboration/CollaborationParticipants.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadEnvelopes.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadSpawnTree.ts
---
**Accepted by the tagma agent (coordinator), 2026-09-28**, after independent Opus and Astra review; its §3a amendments are marked at the head of 44f7f1c3, 9c085c6c and f658e190.

**Accepted design for the P2b cut of [[44f7f1c3|the kernel architecture]] §4.2 and its A6.** It fixes the members of the ports the collaboration kit requires once its native default is removed. Its C1 cuts and names are section 5b rulings ([[2cecbcac]]). Everything it changes in accepted sections is written out in §3a; nothing else is changed silently.

It was written from these sources:
- `packages/agent/src/collaboration/*` and `thread/AgentHarness.ts`, read whole where they decide this;
- the native services behind them;
- the server's fillers: `apps/tagma/server/src/harness/Stack.ts:596-607` and `HarnessReports.ts`.

Reading was at `ed27ac1767`, and the kit files are unchanged at `31ea868b76`. Round two fixes both second reviews: Opus K1–K5 and Astra R1–R7 and R9. No code or test ran.

## 1. Outcome

The kit (`src/collaboration`) builds against six required product ports and nothing native.

| Port | Subject |
|---|---|
| `Threads` | the threads the kit may address |
| `ThreadRuns` | the run the selected harness holds on one of them |
| `ContextCompaction` | compacting a collaborator's context |
| `ThreadModel` | moving a collaborator's model |
| `ThreadBudget` | a tree's allowance and spend (existing tag, made required) |
| `ThreadTypes` | the agent types a caller may start, and the harness each runs on (today's `CollaborationConfig.types` value, made a tag) |

The kernel's `ThreadInbox` gains a keyed `control` unit, so the kit's three in-unit inbox acts need no native store.

A composition that declares collaboration without these does not build. `CollaborationParticipants`, the kit's `owns`/`accepts` tests and every native service in the kit's layer requirements are gone.

- Tagma's `threads` fills `Threads`, `ThreadRuns`, `ThreadBudget`, `ThreadTypes` and `ThreadInbox` by dispatching through `Harness`.
- `native-harness` fills `ContextCompaction` and `ThreadModel`.
- The memory adapter composes the kernel's native implementations explicitly.

## 2. Problem, with evidence

- **Native services are the kit's default.** `threadEnvelopesLayer` (`ThreadEnvelopes.ts:140-154`) and `threadSpawnTreeLayer` (`ThreadSpawnTree.ts:218-238`) require these native services: `ThreadTurnRunner`, `ThreadSignals`, `ThreadRunLedger`, `ThreadCompactionRuns`, `ThreadBranch`, `ThreadStore`, `ThreadSnapshots`, `ThreadChanges`, `ThreadRunSettlements`, `ThreadAgents` and `ThreadCompactor`. `deleteChild` reaches `ThreadAggregate` per call (`:1083`). Every verb runs natively unless `participants.owns(thread)` says otherwise (`ThreadEnvelopes.ts:245`, `ThreadSpawnTree.ts:292,314,337,475,959,1070,1086`).
- **Reads and spend are native.** `ThreadRights`, `ThreadSpawnAccess` and `ThreadObligations` walk native `ThreadRow`s. `collaborationBudgetLayer` sums native `ThreadRunAccounting` spend (`collaborationBudget.ts:17`). `ThreadDirectory` derives liveness from the native lease rhythm (`ThreadDirectory.ts:101,129`).
- **Endings come from the native bus and transcript.** Two ending reactions subscribe to the native settlement bus in layer order (`collaborationReports.ts:11`, `ThreadSpawnTree.ts:1132`). Reports read native transcript entries (`ThreadEnvelopes.ts:404,443`, `ThreadSpawnTree.ts:1116`). The external harness reports on its own road with its own identities (`HarnessReports.ts:153-243`).
- **Tagma's participant map is partial.** It covers spawn, deliver, stop, continue and delete (`Stack.ts:596-607`). Stop carries no fence, since the kit passes no expected run to `HarnessSessions.stop`. Compaction, model move and fork have no external road at all.
- **Replay identities are missing.** Tool verbs pass no caller identity for stop, continue, move, compact or sends (`ThreadPlaneAccess.ts:101-104,112-123`). Envelope ids are minted fresh per call (`ThreadEnvelopes.ts:581-582,705-706`). A compaction mints its run and barrier inside the call (`ThreadCompactionRuns.ts:494-518,552-558`). A lost answer therefore cannot be replayed after a restart.

## 3. Rulings that shape the ports

- **The C1 cut.** Read as `<Tag>.<member>`, compaction needs the noun *context* and a model move needs *model*. Budget is its own subject, already asked by the native run machine (`ThreadRunStarter.ts:202`, `ThreadTurnRunner.ts:724`). Agent types are the subject of the product's library, not of a thread. Each of the four is its own tag. In Tagma the cut also follows the implementer: `threads` cannot reach native context or model, and the accepted `Harness` has no compaction or model face (section 1 §1.4.3).
- **Rights and depth stay the kit's.** They are computed by `ThreadRights` and `ThreadSpawnAccess` over `Threads.lineage`.
- **Names.**
  - *catalog* has one meaning in the glossary regions (5b §2.11): a vocabulary the graph installs. The thread collection is therefore the plural `Threads`, holding the collection's own acts (C10), and the type list is `ThreadTypes` (spelling from [[1deb33b8]]).
  - *Runtime* is retired in `packages/agent` (5b §2.7). The run port is the plural `ThreadRuns`, holding acts on the runs of a thread: start, read the current one, deliver into it, continue, stop.
- **`ThreadTypes` is a tag, not a `CollaborationConfig` value.** Its members perform per-birth I/O over project settings (`Stack.ts:609-616`). 5b §2.6 makes a dependency a service, never a config value. `CollaborationConfig` loses `types`.
- **`answer` and `cancel` are not run members.** No kit code answers or cancels an execution's pending interaction. The two kit acts the §4.2 prose resembles act on the kit's own inbox records:
  - a final answer closing requests (`ThreadEnvelopes.ts:279-347`);
  - a person's take-back withdrawing a queued request (`:526-567`).

  An ask's answer and cancel stay Tagma's `Harness.answer`/`cancel`, reached by `answer_ask`/`cancel_ask`.
- **wake is not a member.** Waking is `deliver`'s `woken` arm; the first opening is `start`.
- **Endings enter as an event.** `RunEnded` carries its own ending identity (§4.2), and the kit's two stages consume it. The stages are `ThreadSpawnTree.settled` (seat, parent snapshot, `agent-result` trace), then `ThreadEnvelopes.completeRun` (reports). The emitting harness's settlement pipeline calls them in that order, acknowledging each durably (§5.4). The order that 3fe7a194 gets today from subscription order becomes declared.
- ***run* is kept for a thread's span of work.** In these ports a run is one span of work the selected harness holds on a thread: a native run, or an external session. The kit's receipts, the inbox's stored `deliveredToRunId`, `spawnedByRunId`, `bornOf.by` and the directory's `activeRun.runId` already carry a session's id as its run (`thread/ThreadDirectoryStore.ts:97-102`, `HarnessSessions.ts:216-223`). Stored carriers keep their spelling (5b rule 9), and *execution* is the executions module's word. This is final, not open.
- **Model selections are the kit's own type.** They are `ThreadModelSelection { provider, model, reasoning }` (`ThreadPlaneAccess.ts:65`), never llm's `ModelSelection { model, rung, switches? }`. An unjudged ask is `Partial<ThreadModelSelection>`.
- **Publication belongs to the committing act's owner.** Every `ThreadSnapshots.publish` or `ThreadChanges.publish` the kit makes after an act is dropped. The implementation of the member that committed publishes after commit, and waiters observe through `Threads.watch`.

## 3a. Amendments to accepted sections

1. **[[44f7f1c3]] §4.2's run member list** is `current, start, deliver, continue, stop`. answer/cancel are withdrawn from it for the reason in §3. The common catalog is cut into `Threads`, `ThreadBudget` and `ThreadTypes`, and `ContextCompaction` and `ThreadModel` are added.
2. **[[9c085c6c]] §3.13.7.5, record table row "Run start (`ThreadRunStarter`)".** Add:

   > A run that a caller's keyed act opens — `ThreadRuns.start`, `ThreadRuns.continue`, an idle `ContextCompaction.compact` — records that caller key beside `start_digest` on its own row, in `thread_run.start_key`. The first lookup is by `(thread_id, start_key)`: the same digest replays the stored run, another digest answers `act-id-reused`, and absence is a new act. Internal starts keep the run-id lookup.

   The run row already decides the act, so this adds no generic receipt; it makes the row findable by the caller's identity.
3. **Same table, row "A caller's append on a thread with no other record".** It reads "append or patch". A `ThreadModel.move`'s patch of the native row is decided by nothing else, so it writes `thread_call(actor, operation, key, thread_id, digest, result, at)` in the same unit as the patch.
4. **§3.13.7.5 "How long the evidence lives", deletion tombstones.** They cover `thread_run.start_key` rows too, so a key whose thread was deleted answers `spent`.
5. **§3.13.7.5 `control`.** The kit's inbox-only units take `ThreadInbox.control` (§4.7): the same keyed protocol, locking the thread's neutral record rather than the native row. It exists because an external thread has no native row to lock.
6. **Section 1 [[f658e190]] §1.2, the `Harness` contract.** It gains the face `spent(spawnRootId, principal)`, answering `{ tokens, unmeasured: readonly threadId[] }`: what this harness measured of a tree's spend, and which of its threads it cannot measure. `threads`' `ThreadBudget` reads spend through it (§4.5).

## 4. The ports

**Placement.**

- Contracts are defined in the kit's files `src/collaboration/threads.ts`, `runs.ts`, `compaction.ts`, `model.ts` and `types.ts`.
- `ThreadBudget` and `ThreadInbox` stay in the owner-local thread contracts, because the native run machine consumes them.
- Every tag is inline with id `@runlith/agent/<Tag>`, consumers write `X['Service']`, and no member has a requirement (`R = never`).

**Native implementations.** They are defined with the native command coordination in `src/thread/run/Commands.ts` (44f7f1c3 §3), built from the code named in §6:
- `nativeThreadsLayer`, `nativeThreadRunsLayer`, `nativeContextCompactionLayer`, `nativeThreadModelLayer`;
- `nativeThreadBudgetLayer` (today's `collaborationBudgetLayer`);
- `agentTypes` (today's `agentTypeCatalog`), with the inbox's `control` in its storage adapters.

**Tool contributions.** `nativeThreadRunsLayer` takes a `Deferred<ThreadToolContributions['Service']>` that `AgentHarness` completes once the merged contributions are built. A run opened earlier waits on it and never runs without tools. This replaces today's per-call provision (`ThreadSpawnTree.ts:909-916`), which the kit's plane → `ThreadRuns` → contributions cycle required.

### 4.0 Keyed acts: one rule for every port

**Caller identity.** Every act that changes state takes `request: { key, deadline }`. `key` is the caller's stable identity:
- a tool call's id, which is recorded with its step's messages before the call is dispatched (44f7f1c3 §6.2);
- a plan dispatch's `run:step:attempt:name`;
- a Tagma operation's call key (section 4);
- the facade caller's own key, which `AgentHarness`'s methods gain as an argument.

`ThreadPlaneAccess` passes the tool call id to `spawn`, `stop`, `continue`, `move`, `compact`, `fork`, `messaging.send` and `settleFinal`. A tool-sent envelope's id is `envelope:<intent>:<sender>:<key>`, as §3.13's envelope row states, instead of `mintThreadEnvelopeId()`.

**Idempotency.** The implementation forms §3.13's `CallKey` from the member, the thread and `key`, and a digest over the member's semantic input. The authoritative record is looked up first (§3.13.7.5), and no participant runs on a replay.

**Answer arms.** Every keyed answer carries these:
- `acted: boolean`, where `false` is §3.13's *replayed*: the first acceptance's payload, recorded;
- a `spent { at }` arm: the act happened and its result is gone (tombstone or epoch).

**Failure classes.** Every keyed member may fail with its subject's classes:
- `…Conflict{ reason: 'act-id-reused' | … }`: the same key with another digest;
- `…Unavailable{ reason: 'deadline' | … }`: proved that nothing committed, so a retry is safe;
- `…Lost{ key }`: the outcome is unknown after a possible commit. It is settled by retrying the same key, never by a new one.

A compaction or a model patch whose unit may have committed is never reopened because its answer was lost: the replay reads the recorded run or record.

### 4.1 `Threads` — `@runlith/agent/Threads`

The harness-neutral collection. A read authorizes nothing by itself: the unit of the act it informed rechecks what that act depends on.

**`ThreadRecord`** replaces the native `ThreadRow` everywhere in the kit, including the callbacks of §6. It has these fields:

- `id`, `principal`, `agentId`, `typeId`, `name`, `spawnRootId`, `parentThreadId`, `spawnedByRunId`, `bornOf`, `createdBy`;
- `harness`: the opaque id of the harness running it;
- `host`: a `ThreadHostBinding`, or null;
- `authority`, `rights`, `budgetTokens`;
- `capabilities: ThreadCapabilities`;
- `model: ThreadModelSelection | null`;
- `profile`: a profile id, or null.

No native history, prompt, pending interaction, run row or switch is part of it.

**`ThreadCapabilities`** is `{ messaging, compaction, modelMove, fork, readReach, judgedModel }`, all booleans. `judgedModel` says that the kit judges the model against its model list; when false, the harness judges the raw ask.

| Member | Input → answer | Failure | Transition, key |
|---|---|---|---|
| `find` | `(threadId, principal)` → `ThreadRecord \| null` | `ThreadReadFailure` = `ThreadStorageFailed \| ThreadRecordUnreadable` | read |
| `named` | `(principal, spawnRootId, name)` → `ThreadRecord \| null` | same | read; `create` rechecks the name in its unit |
| `lineage` | `(threadId, principal)` → `{ ancestors: readonly ThreadRecord[]; complete: boolean }` | same | read; see below |
| `list` | `ThreadListQuery { principal, from, ids?, parent?, limit, cursor? }` → `{ rows: readonly ThreadDirectoryRow[], total, cursor }` | same | read, paged (rule 68659e3b) |
| `watch` | `(threadIds)` → `Effect<Effect<void>, never, Scope>`: a latch completing when a named thread's record, run or inbox moved | none | subscription scoped to the waiter |
| `readBirth` | `(parentThreadId, principal, key)` → `{ status: 'born', thread } \| { status: 'spent', at } \| { status: 'unborn' }` | `ThreadReadFailure` | reads the provision receipt, then the tombstone, for the birth key |
| `create` | `BirthInput` → `{ status: 'created', thread, acted } \| { status: 'spent', at }` | `BirthFailure` | birth, keyed; see below |
| `delete` | `(threadId, principal, by)` → `{ status: 'deleted' } \| { status: 'absent' }` | `ThreadDeleteFailure` = `ThreadDeleteRefused{ reason: 'still-settling' \| 'not-a-descendant' } \| ThreadDeleteConflict \| ThreadStorageFailed` | §5.3 deletion; the thread id is the key |

**`lineage`**

- **Order.** `ancestors` lists the parent first and excludes the addressed thread.
- **Completeness.** `complete` is true only when the last ancestor has no parent. It is false when an ancestor is missing, when an ancestor belongs to another principal, or when the chain exceeds `SUB_AGENT_DEPTH.maximum`.
- **The ceiling.** The constant ceiling bounds the read; today's per-project setting never truncates it.
- **Incomplete chains fail closed.** For an incomplete chain, `ThreadRights` answers no rights (today `ThreadRights.ts:26`), `ThreadSpawnAccess` refuses naming the missing ancestor (today `:51-54`), and the descendant check answers not-a-descendant.

**`ThreadDirectoryRow`** moves here from `thread/storage/directory.ts`, and the `ThreadDirectoryStore` port and its `directory` member dissolve into `list`.
- `activeRun` becomes `run: CurrentRun | null`, supplied by the harness with its own `life` and `stalledSince`. This replaces the kit's lease-grace computation.
- The `driver` field goes (5b §4.6).
- `contextReading` and `selection: ThreadModelSelection & { account }` are filled only by a harness holding them.

**Birth**

Settlement comes first. The kit calls `readBirth(parent, principal, requestKey)` before any admission:
- `born`: the kit answers with that child and finishes readiness on it through `ThreadRuns.start`. No type, depth, rights, budget, delegation, name, seat, placement or model step runs again.
- `spent`: the kit answers `spent`.
- `unborn`: the kit applies the common admission (§9): type (`ThreadTypes.resolve`), depth, rights, budget, name pre-check, seat, delegation, placement, and model judgment when `judgedModel`. It then calls `create` once.

`BirthInput` carries:
- `request`: its key and deadline;
- `childId`: minted by the kit before the first call and reused by its retries;
- `parentThreadId`, `principal`, the resolved `ThreadTypeOffer`, `lineage: 'child' | 'branch'`, `name`;
- `rights`, `authority`, `host`, `place`;
- `model: { judged: ThreadModelSelection } | { asked: Partial<ThreadModelSelection> } | null`;
- `seed: { fresh } | { fork: ThreadForkCut, fromCall? }`;
- `bornOf`, `spawnedByRunId`;
- `provision`: the task item, or `null` for a branch.

The key is `{ envelope: spawn:<parent>:<key> }`, or `fork:<source>:<key>` for a branch. The digest covers task, type, name, host, seed, reach, the asked rights and the asked model.

- **Native.** `prepareBirth` runs outside every hold. The `birth` unit then:
  1. reads the receipt and the tombstone first;
  2. rechecks the parent's `(fold_rev, head, inherit_rev)`, pending interaction, foreign run, owner, the child's absence and the name;
  3. writes, together: the record, the mandate, the native row and the seeds; the switches composed from the parent and the product's `ThreadHostConfig.modelSwitchesFor` (today `standingSwitches`, `ThreadSpawnTree.ts:262-272`; the stored switch fields stay unchanged); the product's in-unit birth participants (today `onThreadBorn`); and the provision receipt.
- **External (Tagma).** The same unit runs in `threads`, with `Harness.born` writing the session row and judging a raw model ask.

A `create` answered `acted: false` — a racing caller made the child — hands back the seat it took and calls the placement hook's `released` for the place it resolved. Today's `spawn-raced` refusal retires. A stale preparation retries inside `create` under the deadline with the same child id.

`BirthFailure` = `ThreadMissing | BirthRefused | BirthConflict | BirthUnavailable | BirthLost | ThreadStorageFailed`, where:

- `BirthRefused.reason` is `'host-unadmitted' | 'host-with-fork' | 'pending-interaction' | 'harness-contract' | 'harness-host' | 'model-unnamed' | 'model-unavailable' | 'thread-project-missing'`. These are today's codes, frozen.
- `BirthConflict.reason` is `'name-taken' | 'spawn-conflict' | 'birth-id-taken' | 'run-conflict'`. `spawn-conflict` is `act-id-reused` for this record kind.
- `BirthUnavailable.reason` is `'deadline'`.

**`delete`.** The product:
1. closes admission;
2. ends the current run through its own `ThreadRuns.stop`;
3. resolves child and resource obligations;
4. writes, in its final unit, the `spent_call_key` tombstones before the cascade (§5.3; §3a.4).

A retry answers `absent`. An external release still pending refuses `still-settling` rather than answering `deleted`.

### 4.2 `ThreadRuns` — `@runlith/agent/ThreadRuns`

The run the selected harness holds on one thread, and the controls over it.

**`CurrentRun`** is `{ runId, life: 'working' | 'awaiting', askPrompt, since, stalledSince }`.

**`ThreadRunsFailure`** = `ThreadMissing | ThreadRunConflict | ThreadRunRefused | ThreadDeliveryConflict | ThreadRunUnavailable | ThreadRunLost | ThreadStorageFailed`, where:

- `ThreadRunConflict.reason` is `'running' | 'act-id-reused'`, and `running` carries the standing run.
- `ThreadRunRefused.reason` is `'not-interrupted' | 'session-reporting' | 'session-deleting' | 'cli-standing' | 'harness-missing'`, today's codes.
- `ThreadDeliveryConflict` is an item id already accepted with other content (today `ThreadSignalConflictError`).
- `ThreadRunUnavailable.reason` is `'not-ready' | 'deadline'`. `not-ready` means the readiness steps failed: the provision stands, and the same `start` is retried onto the same child (§5.3).
- `ThreadRunLost{ key }` covers an unknown commit or a partly typed delivery. It is never repeated automatically.

| Member | Input → answer | Transition, key; native / external |
|---|---|---|
| `current` | `(threadId)` → `CurrentRun \| null` | a read of the harness's authoritative record: the fence source for `stop`. Native: the running `thread_run`. External: the live session |
| `start` | `(threadId, { request, itemId, text })`, after `create` committed; `text` is the kit's birth header and task → `{ status: 'started' \| 'queued', runId, acted }` | readiness first, idempotently (Tagma: rollout, guest, worktree note; today `onThreadReady`). The key is the provision item id. **Native:** a run start `transition` with `start_key` = that id (§3a.2), delivering the provision in the same unit. A run this key did not open queues the provision behind it (`queued`). **External:** `Harness.begin`, a launch intent keyed the same way |
| `deliver` | `(threadId, item)`, the item already accepted by the kit's `inbox.put` → `{ status: 'queued' \| 'delivered' \| 'woken' \| 'stored', runId: string \| null, acted }` | The item id is the key. The item's kind decides the road: a task opens or queues; an interrupt cuts the standing run first; words deliver or wake; a notice goes only to its run. **Native:** `transition`/`control` keyed `{ inboxItem, run }`. **External:** `Harness.deliver`. A repeat answers the item's current state, and acts again only on an item still queued with no run |
| `continue` | `(threadId, { request })` → `{ status: 'continued' \| 'joined', runId, acted } \| { status: 'spent', at }` | **Native:** a fresh run with `start_key` = the request key, only when no run stands and the latest was interrupted. **External:** joins the open session (`joined`) or opens one under a launch intent keyed by the request |
| `stop` | `(threadId, { request, expected: runId, by: 'parent' \| 'agent' \| 'reader' })` → `{ status: 'stopped' \| 'stopping' \| 'not-running', acted }` | **Native:** a run end `transition` keyed `(run, end)`, its digest carrying status and `by`. `not-running` when no run stands or `expected` is no longer current, so a replacement is never stopped. **External:** quit keys; `stopping` until the session's ending is proved |

**`RunEnded`** (5b P7: an event after commit) is:

```
{ threadId, principal, runId, ending, kind: 'answered' | 'ended',
  status: 'completed' | 'failed' | 'aborted' | 'cut', stoppedBy,
  work: 'turn' | 'keep-warm' | 'compaction', handled: readonly string[] | null,
  answer: string | null, report: string | null,
  failure: ThreadFailureDiagnostics | null, failureReason }
```

- **`ending`** is the ending's own identity. It keys each stage's acknowledgement and completes the report envelope id `envelope:report:<request>:<ending>`:
  - a native run's ending is its `runId`;
  - an external answered turn is `<session>:<turn>`, with `kind: 'answered'` and `status: 'completed'`;
  - an external session end is `<session>`, with `kind: 'ended'`.

  Every envelope id stays byte-identical to today's (`threadReportEnvelopeId`; `HarnessReports.ts:168,234`).
- **`handled`** is the requests this ending answers. It is null for `ended`, where the stage reads the requests delivered to `runId`, as today. For an answered turn it is the requests that turn's delivery claims ended (`HarnessDeliveries.answered`, `HarnessReports.ts:160`).
- **`answer`** is the closing text: native, from the harness's own transcript (`ThreadEnvelopes.ts:791-801`); external, the CLI's turn text.
- **`report`** is present when the harness words its own report: Tagma's external `harnessAnswerReport` and `harnessProcessReport`. Otherwise the kit words it.

**The stages.**
- **`ThreadSpawnTree.settled(ended)`** runs for both kinds. It releases the child's seat once per child, as today's `released` set does; traces `agent-result`; and publishes the parent.
- **`ThreadEnvelopes.completeRun(ended)`** answers the newest open request per requester among the handled ones. For `ended`, a completed status acknowledges the handled requests, as today for both roads.

The native run machine's settlement outbox emits native endings. External-harnesses emits external endings from today's `turnAnswered` and `sessionEnded`, which lose their own delivery loops. Each emitter keeps a stage ledger keyed `(ending, stage)` (§5.4). The standing-ask notice (`asked`, `envelope:ask:…`) is not an ending and stays a direct `ThreadEnvelopes.deliver`.

### 4.3 `ContextCompaction` — `@runlith/agent/ContextCompaction`

| Member | Input → answer | Transition, key |
|---|---|---|
| `choosesSummarizer` | `boolean` (today `ThreadCompactor.choosesSummarizer`) | — |
| `compact` | `(threadId, { request, keep?, at?, summarizer? })` → `{ status: 'completed' \| 'unchanged' \| 'failed' \| 'aborted', runId, history: { before, after }, summarizer, skipped, acted } \| { status: 'requested', requestId, at, runId, acted } \| { status: 'joined', runId } \| { status: 'spent', at }` | see below |
| `compactAhead` | `(threadId, { request, item, keep })` → `{ itemId, requestId, runId, started, acted }` | see below |

**`compact`**

- **Idle thread.** A manual compaction run with `start_key` = the request key (§3a.2). The implementation waits for its outcome and reads it from its own entries. A replay finds the run: finished, it answers the recorded outcome; still going, it waits on it. No second pass is opened.
- **With `at`.** A compaction request item whose id is `compaction:<thread>:<key>`, keyed `{ inboxItem }`.
- **Joining** a compaction already going writes nothing.

**`compactAhead`.** The task item and its compaction request are accepted together, keyed `{ inboxItem: item.id }`. The barrier id is derived from the item id, replacing the fresh ids of `ThreadCompactionRuns.ts:552-558`.

`ContextCompactionFailure` = `ThreadMissing | ThreadCompactionRefused | ThreadCompactionConflict | SummarizerMissing | ThreadCompactionUnavailable | ThreadCompactionLost | ThreadStorageFailed`, where:

- `ThreadCompactionRefused.reason` is `'exhausted' | 'unsupported' | 'running'`.
  - `running` carries the standing run and replaces the kit's pre-check (`ThreadSpawnTree.ts:501,508`).
  - `unsupported` is today's product-run refusal (`:475`) and Tagma's `external-context`.
- `ThreadCompactionConflict.reason` is `'prefix-moved' | 'act-id-reused'`. `prefix-moved` is today's class.
- `ThreadCompactionUnavailable.reason` is `'deadline'`.

### 4.4 `ThreadModel` — `@runlith/agent/ThreadModel`

| Member | Input → answer | Transition, key |
|---|---|---|
| `move` | `(threadId, { request, option: ModelOption, reasoning })` → `{ from: ThreadModelSelection, to: ThreadModelSelection, acted } \| { status: 'spent', at }` | see below |

**`move`** is a native `transition` keyed `{ call }`, writing `thread_call` in the patch's unit (§3a.3).
- `decide` refuses while a run stands.
- The patch keeps the switches the option declares, and drops the account on a provider crossing (`ThreadSpawnTree.ts:381-388`).
- The host's record follows after commit: in Tagma, the rollout meta (today `onModelMoved`).

`ThreadModelFailure` = `ThreadMissing | ThreadModelRefused{ reason: 'model-pinned' | 'thread-running' } | ThreadModelConflict{ reason: 'act-id-reused' } | ThreadModelUnavailable{ reason: 'deadline' } | ThreadModelLost | ThreadStorageFailed`. Judgment stays the kit's, over `record.model` and the product's model list (`ThreadSpawnTree.ts:147-174`).

### 4.5 `ThreadBudget` — `@runlith/agent/ThreadBudget` (existing tag)

**`of({ spawnRootId, principal })`** → `{ allowed, spent, remaining, unmeasured: readonly string[] }`.
- It takes the tree's identity, not a row, so the native run machine's callers need no `ThreadRecord`.
- `unmeasured` lists the threads of the tree whose spend no harness can report.
- The kit refuses a child when `remaining !== null && remaining <= 0`, naming the `unmeasured` threads when there are any.

| Composition | Filler | Reading |
|---|---|---|
| Tagma | `threads` | allowance from the root's `thread_mandate`; spend summed over the registered harnesses' `Harness.spent` (§3a.6) |
| memory adapter | `nativeThreadBudgetLayer` | native spend over `ThreadRunAccounting.spentBySpawnRoot`; `unmeasured` is always empty |

- **Tagma's policy.** A tree with an allowance and any unmeasured thread answers `remaining: 0`, so the operator's allowance is never claimed while part of the spend is unknown.
- **Native `spent`.** Native-harness answers its runs' usage sum.
- **External `spent`.** External-harnesses lists its threads as unmeasured.
- **Without collaboration.** `unboundedThreadBudgetLayer` stays only for a composition without collaboration.

### 4.6 `ThreadTypes` — `@runlith/agent/ThreadTypes`

The kernel declares the contract and `agentTypes(agents)` as its native filler.

| Member | Input → answer |
|---|---|
| `resolve` | `({ caller: 'operator' \| 'agent', under: ThreadRecord, typeId })` → `ThreadTypeOffer \| null` |
| `offered` | `({ caller, under: ThreadRecord })` → `readonly ThreadSpawnType[]` |

- **`ThreadTypeOffer`** is `{ baseAgentId, profile?, harness, capabilities: ThreadCapabilities }`. The kit reads `capabilities` to word the birth header, to judge or pass the model, and to refuse a fork or read reach early. `create` stays authoritative on all of these. `ThreadSpawnType` is unchanged.
- **Failure:** `ThreadTypesFailure` = `ThreadStorageFailed | ThreadTypesUnavailable`, the latter for a settings read that broke.
- **Fillers:** Tagma's `threads`, from the agent library with harness types contributed by external-harnesses.

### 4.7 `ThreadInbox.control` — on the existing `@runlith/agent/ThreadInbox`

**Signature.** `control<A>(threadId, plan: InboxPlan<A>, key: Keyed)` → `TransitionOutcome<A>` (§3.13.7.5's outcome), failing with `InboxFailure`.

**Plans.** `InboxPlan<A>` is `{ decide(view: InboxView): Effect<{ apply: (writes: InboxWrites) => Effect<void>; result: A } | { refuse: A }> }`.
- `InboxView` binds `pending`, `openRequests`, `receipt` and `record(threadId, principal)` to the unit.
- `InboxWrites` binds `put`, `acknowledge` and `closeRequests` to the unit.
- No transaction value escapes the plan, and nothing in it waits on a model, network, runtime or another writer.

**The protocol.** The unit locks the thread's neutral record: Tagma's machine writer and `thread_record` row; the memory adapter's version counter. It reads the key's envelope row first (§3.13's envelope record): same digest replays, another digest answers `act-id-reused`, a tombstone answers `spent`. Only a new act reaches `decide`. Delivery of the written envelope happens after commit, as today.

**Fillers.** Tagma `threads` (`store/inbox.ts`) and the memory adapter.

The three kit units become:

| Unit | Key | `decide` |
|---|---|---|
| final answer (`ThreadEnvelopes.ts:314`) | `envelope:final:<request>` | The request is chosen from a snapshot outside the unit. It rechecks that the request is still the requester's newest taken one, puts the report and closes the requester's taken requests. A changed choice refuses, and the kit prepares again |
| fallback report (`:463`) | `envelope:report:<request>:<ending>` | puts the report only while the request is open |
| take-back (`:534`) | `envelope:withdrawn:<request>` | While the item is still queued it reads the requester's record in the unit (`view.record`, today `findOwned(…, tx)` at `:542`). It then puts the report, acknowledges and closes |

## 5. Owners, implementers, callers

| Port | Tagma | memory adapter | Called by |
|---|---|---|---|
| `Threads` | `threads`, from `thread_record_facts`, `thread_mandate` and `Harness.current`. `create` in its birth unit with `Harness.born`; `delete` by its ending walk with `Harness.end` | `nativeThreadsLayer` | `ThreadEnvelopes`, `ThreadSpawnTree`, `ThreadDirectory`, `ThreadRights`, `ThreadSpawnAccess`, `ThreadObligations`, the facade |
| `ThreadRuns` | `threads`, dispatching to `Harness.current`/`begin`/`deliver`/`continue`/`stop`; no native default | `nativeThreadRunsLayer` | `ThreadEnvelopes`, `ThreadSpawnTree` |
| `ContextCompaction` | `native-harness`, over its `Compaction`; refuses `unsupported` for a thread it does not run | `nativeContextCompactionLayer` | `ThreadSpawnTree`, `ThreadEnvelopes.sendAhead` |
| `ThreadModel` | `native-harness`, over `ModelPreferences`; refuses `model-pinned` for a thread it does not run | `nativeThreadModelLayer` | `ThreadSpawnTree.moveChild` |
| `ThreadBudget` | `threads`, over `Harness.spent` | `nativeThreadBudgetLayer` | `ThreadSpawnTree.spawnChild`, `ThreadRunStarter`, `ThreadTurnRunner` |
| `ThreadTypes` | `threads`, from its library | `agentTypes(agents)` | `ThreadSpawnTree`, the plane's `startable` |
| `ThreadInbox.control` | `threads` | inbox adapters | `ThreadEnvelopes` |

- **Binding.** `composition` binds every one at `start`, before admission (section 7 §7.2.7's row for the thread catalog and runtime ports). Until `native-harness M1`, `Harness`'s native binding is §7.2.7's old producer.
- **Tagma's module boundaries.** `threads` imports neither harness. The two native-only ports reach `native-harness` only through composition.
- **Branching.** The kit branches only on `capabilities`, and every native-only member also refuses in its own implementation.

## 6. Every current call site, and what replaces it

**`ThreadEnvelopes.ts`**

| Call sites | Replaced by |
|---|---|
| `:190`, `:202`, `:215`, `:229`, `:231`, `:288`, `:383`, `:453`, `:528` and `:657` (`findOwned`); `:299` (`metadata`); `:418` (`find`) | `Threads.find` |
| `:233` | `Threads.named` |
| `:384` (`settleFinal`'s address) | the kit's `resolve`, over `Threads.find`/`named` |
| `:216` (the addressable names) | `Threads.list` |
| `:245`, `:247`, `:249`, `:252`, `:254`, `:257`, `:261`, `:263`, `:266` and `:736` | `ThreadRuns.deliver`; the native implementation takes these bodies |
| `:404` | `RunEnded.work` |
| `:443` | `RunEnded.answer` |
| `:314`, `:463`, `:534`; `:542` is the in-unit `findOwned` | `ThreadInbox.control` (§4.7), through its `view.record` |
| `:589` | `ContextCompaction.compactAhead` |
| `:621` | `Threads.watch` |
| `:581-582`, `:705-706` (`mintThreadEnvelopeId`) | ids from the caller key (§4.0) |
| `:522`, `:565`, `:611` and `:766` | dropped: the committing implementation publishes |
| `:690` (the reconcile interval) | stays the kit's, read from `CollaborationConfig` instead of the native host config |

**`ThreadSpawnTree.ts`**

| Call sites | Replaced by |
|---|---|
| `:289`, `:308`, `:331`, `:822`, `:957`, `:1084` and `:1114` | `Threads.find` |
| `:651` | `Threads.named` |
| `:276` | `Threads.list` with `parent` |
| `:412`, `:417` (the descendant walk) | `Threads.lineage` |
| `:645-648` (`provisionedChild` before admission), `:820` (`inbox.receipt`), `:941` (the delegation skip) | `Threads.readBirth`, now before all admission |
| `:578`, `:678`, `:680`, `:703`, `:718`, `:720`, `:723`, `:733`, `:767`, `:779`, `:781`, `:1001` and `:1070–1076` | `Threads.create` |
| `:1083`, `:1086`, `:1087` | `Threads.delete` |
| `:293` | `ThreadRuns.current` |
| `:292`, `:295` | `ThreadRuns.stop` |
| `:314`, `:315` | `ThreadRuns.continue` |
| `:538`, `:842`, `:843`, `:855`, `:868`, `:872` and `:879` | `ThreadRuns.start` |
| `:337`, `:350`, `:389`, `:391`, `:398` | `ThreadModel.move` |
| `:475`, `:501`, `:504`, `:505`, `:508`, `:521`, `:522`, `:523` | `ContextCompaction.compact` |
| `:935` | `ContextCompaction.choosesSummarizer` |
| `:603` | `ThreadBudget.of` |
| `:570`, `:931`, `:197` | `ThreadTypes.resolve`/`offered` |
| `:871` | `ThreadCapabilities.messaging` |
| `:890` | `record.model` |
| `:1116` | `RunEnded.work` |
| `:959` | removed: `answerSpawn`'s one road serves every harness through `start` |
| `:1132` | the stage `ThreadSpawnTree.settled` |
| `:392`, `:393`, `:524`, `:714`, `:803`, `:882`, `:1088` and `:1130` | dropped: the implementation publishes |
| `:909-916` (tool sources provided per call) | the `Deferred` of §4 |

**Other kit files**

| Call site | Replaced by |
|---|---|
| `collaborationReports.ts:11` | the stage `ThreadEnvelopes.completeRun(ended)` |
| `collaborationBudget.ts:14,17` | `nativeThreadBudgetLayer` |
| `ThreadRights.ts:25`, `ThreadSpawnAccess.ts:50` | `Threads.lineage`, failing closed |
| `ThreadObligations.ts:73` | `Threads.find` |
| `ThreadDirectory.ts:98` | `Threads.list` |
| `ThreadDirectory.ts:101`, `:129` | the row's `run.life` and `run.stalledSince` |
| `ThreadPlaneAccess.ts:88-106`, `:112-123` | gain the caller key (§4.0) |

**Product-facing signatures that change from `ThreadRow` to `ThreadRecord`**

- `CollaborationConfig.ts:27`: `placement.asking(thread: ThreadRecord)`.
- `CollaborationConfig.ts:29`: `placement.resolve({ parent: ThreadRecord, … })`.
- `CollaborationConfig.ts:57`: `subAgentDepth(thread: ThreadRecord)`.
- `CollaborationConfig.ts:58`: `delegation(thread: ThreadRecord)`.
- `CollaborationConfig.ts:59`: `types` leaves for the `ThreadTypes` tag.
- `CollaborationConfig.ts:53`: `participants` goes.
- `CollaborationVoice.ts:303`: `branchBirth({ source: ThreadRecord, … })`.
- `CollaborationVoice.ts:324-325`: `collaborationBirth({ parent: ThreadRecord, child: ThreadRecord, … })`.

Tagma changes their fillers of these in the same commit.

**`thread/AgentHarness.ts`**

- `:226`: `participants` goes.
- `:290-291`: the budget fallback applies only without collaboration.
- `:312`: the reports layer becomes the stage.
- The facade methods `:400-406`, `:506-528`, `:602-612` and `:734-744` stay the native application facade. They gain a caller key and hand the kit a `ThreadRecord` from `Threads.find`.

**Server fillers**

| Today | Target |
|---|---|
| `Stack.ts` participant `spawn` (`HarnessBirths.spawn`) | `Threads.create` through `Harness.born` |
| `deliver` (`HarnessSessions.receive`) | `ThreadRuns.deliver` through `Harness.deliver` |
| `stop` (`HarnessSessions.stop`) | `ThreadRuns.stop` through `Harness.stop`, now always with `expected` |
| `continue` (`HarnessSessions.start`) | `ThreadRuns.continue` through `Harness.continue` |
| `delete` (`ThreadEnding.delete`) | `Threads.delete` |
| `owns`, `accepts` | removed |
| `HarnessReports.turnAnswered`/`sessionEnded` (`:153-243`) | emit `RunEnded` |

**What the kit still requires.** Its own tags, plus `ThreadInbox`, `ThreadAttachments`, `ThreadCacheCurve`, `ThreadToolContributions`, `DeclaredCollaboration` and `ThreadResidency`. `ThreadResidency` stays the kit's seat service, consumed by the native run machine for its own resumes.

## 7. Rejected alternatives

- **Two tags exactly as §4.2 names them.** Compaction, model, budget and types would sit inside the catalog or runtime. That fails C1, and in Tagma two modules would implement one tag.
- **A kernel copy of Tagma's `Harness`.** Its `folded`, `record`, `quiet`, `row`, `titleContext` and `models` faces are Tagma's journal and list concerns, which no kit code calls.
- **A record shaped like the native `ThreadRow` with optional native fields.** It is the fabricated native row §4.2 forbids.
- **An endings subscription.** The order would again be whatever order the layers subscribed in.
- **External reports on their own road beside the stages.** The reports stage and the seat stage would split across two recovery mechanisms, with no common acknowledgement.
- **A generic `thread_call` receipt for every caller-keyed act.** It would sit beside the run row that already decides a run start, which §3.13 forbids. The run row carries the key instead (§3a.2).

## 8. Acceptance

1. **Direction.** The package direction check shows no file under `src/collaboration` importing any of these: `ThreadTurnRunner`, `ThreadSignals`, `ThreadRunLedger`, `ThreadCompactionRuns`, `ThreadBranch`, `ThreadAggregate`, `ThreadStore`, `ThreadSnapshots`, `ThreadChanges`, `ThreadRunSettlements`, `ThreadRunAccounting`, `ThreadAgents`, `ThreadCompactor`, `ThreadDirectoryStore`, `thread/storage/aggregate`.
2. **No fallback.** `CollaborationParticipants` and `CollaborationConfig.types` do not exist. A composition declaring collaboration without the six ports and `ThreadInbox.control` fails to typecheck.
3. **One conformance suite.** The common suite in the testing entry runs the native layers and a scripted external harness through the same cases:
   - a lost answer to `create`, `start`, `deliver`, `continue`, `stop`, `compact`, `compactAhead`, `move` and each `control` replays with `acted: false`, and no participant runs twice;
   - an idle compaction replayed after its run finished answers the recorded outcome without a second model pass;
   - a reused key with another digest conflicts, and a key tombstoned by deletion answers `spent`;
   - a spawn replayed after its child exists answers that child even when the name, a seat, the budget, delegation or the offered type would now refuse, and a failed readiness retries onto the same child;
   - `stop` with a stale `expected` leaves the replacement running;
   - an incomplete `lineage` yields no rights, refuses depth and is not a descendant;
   - compaction, model move and fork on the external harness refuse `unsupported`, `model-pinned` and `harness-contract`;
   - no external record or row carries a native field;
   - `list` pages with a total;
   - an external answered turn and the session end reach the stages as two endings with today's envelope ids.
4. **Products.** `threads` builds with no native run service in its layer.
5. **Order.** A report lands before the follow-up wake, by declared stage order.

## 9. Decided here: nothing is left to a builder

- **Report grain:** both external ending kinds enter the stages (§4.2).
- ***run*:** final (§3).
- **Tool-contribution cycle:** the `Deferred` (§4).
- **Unmeasured spend:** Tagma's policy (§4.5).
- **`ThreadTypes`:** a tag, with its offer shape (§4.6).
- **Neutral model type:** `ThreadModelSelection` (§3).

Spellings owned by [[1deb33b8]] and [[aa1b0681]] follow these; this decision owns the member lists.

## 10. The rest of the spec list

- **Contract (10):** the kernel surface changes once, in P2b, with Tagma and the memory adapter in the same commit (Q7, §6.6). No aliases.
- **Stored data (11):** `thread_run.start_key` and the widened `thread_call` and tombstones (§3a) ride perf E5's migration with §3.13's other columns. Envelope ids keep their stored forms; new tool sends use `envelope:<intent>:<sender>:<key>`.
- **Authority (12):** unchanged. The kit decides lineage, rights, depth, budget and delegation at the verb, and each unit rechecks the facts it acts on.
- **Long-lived state (13):** `watch` subscriptions end with their waiter's scope. The kit's in-process seats are unchanged until §9's durable residency.
- **Bounded resources (14):** `list` takes a limit; `lineage` is bounded by the constant ceiling. No new figure.
- **Rollout (15):** P2b follows P2a's keyed protocol. Running native runs are unaffected; external sessions keep their custody.
- **Failures (16):** every keyed act follows §4.0. A restart re-drives endings from the first unacknowledged stage.
- **Observability (17):** the kit's `delivery`, `agent-spawned`, `agent-result` and `report-*` traces stay, and every answer carries `acted`.

**Claims and tasks.** No claim is verified or closed by this decision. At P2b the builder rewrites these from the code:
- [[98fa5113]] (participants): replaced;
- [[62d74849]] and [[68714383]] (liveness supplied by the harness);
- [[bc8d751d]] (the model refusal from `ThreadModel`);
- [[d87db69c]] and [[19d4d179]] (external reports, now through the stages);
- [[8c910eb1]], [[ac058ca1]], [[caa03cde]] and [[2c868472]]: re-anchored to `start`, `readBirth`/`create` and `move`.

The claims [[44f7f1c3]] §13 lists keep that disposition. No task is opened here.

**Order of building**

1. Declare the six contracts, `ThreadInbox.control`, `RunEnded` and their conformance suite, with §3a's columns in perf E5.
2. Build the native layers in `Commands.ts` from the code of §6.
3. Convert the kit, delete `participants`, and thread the caller keys.
4. Compose the memory adapter.
5. In Tagma's `threads M1`, fill `Threads`, `ThreadRuns`, `ThreadBudget`, `ThreadTypes` and `ThreadInbox.control` through `Harness`. `native-harness`, or its §7.2.7 binding, fills the other two, and external-harnesses emits `RunEnded`.
