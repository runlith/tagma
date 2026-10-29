---
id: 01a11c9a-6edb-7ed8-b517-60ad2121a95f
title: "Transport contract: the adapter runs a core-opened run, reports facts as a write plan, declares capabilities"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/service/harness.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
  - kind: file
    ref: packages/agent/src/thread/transport/contract.ts
---
Goal: a transport adapter is a narrow contract declared by the core in `packages/agent/src/thread/transport`. The adapter takes a run the core already opened and committed, plus words for it. It reports run facts as a write plan executed in its own write. It declares capabilities. The adapter holds no run decision and no run state.

## Binding, agent, and capabilities

- **`TransportBinding`** — `{ adapter, profile, agent }`, a column of the core thread row.
  - `agent` is the native agent id whose prompt, catalog, and rules `ThreadHosting` serves to the profile with Tagma tools (the Claude runner). Today it lives in `facet.hosts` (`hostedOperations.ts:22-33`). For the rest `agent` is empty. That is a core field: `ThreadHosting` reads it. The core never reads `adapter` or `profile`.
  - The row's `agentId` stays `harness` for every outside thread: the row invariants (`native-harness/rows/native.ts:86,113`), the kind list, and the app stand on it.
  - Birth and transport change write the binding: `set_thread_transport`, plus a model change whose target is served by another adapter. Moving between native and the Claude runner moves the agent id between `agentId` and `binding.agent` in one `HarnessMoves` act, as between `agentId` and `hosts` today.
  - The change checks "no running run" and writes the binding and a `transport` feed record in one lane transaction. Today a model change between roads writes no record.
  - The core never compares binding values: it hands them to `Transports.of(binding)`, and composition fills the registry.
  - An adapter report from a thread whose binding it does not hold is refused `foreign-binding`.
- **Model choice** — provider, model, reasoning in the core row of every thread. That is the choice Tagma asked. The model the vendor observes stays the adapter's observation, as `modelWords.ts` distinguishes.
- **`TransportCapabilities`** — a snapshot in the core row.
  - The profile and what the vendor declared in `initialize` compose it. The adapter repeats it at birth, transport change, model change, and process start, and it is written only when it changes.
  - The core, doors, and lists read the snapshot with the row and never ask the adapter.
  - That absorbs `ThreadCapabilities` (`thread/record.ts:25-32`) and the `proves` facet.
  - The stall threshold derived from `callEnvelope` sits as a scalar in the row column: the list filter reads it.

| Capability | Values | Who reads | Answer when missing |
|---|---|---|---|
| `steer` | `step`, `none` | scheduler on Enter mid-run | the word becomes a follow-up, answer `queued`; `steer` answers `not-steerable`, as a compaction run does today |
| `withdraw` | `true`, `false` | `unqueue` of a delivered steer | `withdraw-failed`: the word is delivered and not revoked |
| `interrupt` | `run`, `resource` | Stop | on `resource` Stop also finishes the process; the run end is the same `aborted` |
| `continue` | `true`, `false` | `continue_thread` with no waiting words; the `cut` report text | `transport-cannot`; with words the run opens normally |
| `history` | `journal`, `session`, `none` | rewind, fork, withdraw | `transport-cannot` |
| `compaction` | `core`, `session`, `none` | `/compact` and the threshold | a manual request is `transport-cannot`; the threshold does not fire, and context reading stays visible |
| `modelMove` | `live`, `relaunch`, `pinned` | `set_thread_model`, `set_agent_model` | `model-pinned` |
| `pictures` | `true`, `false` | word intake | `attachment-rejected` |
| `openings` | `core`, `core-and-observed` | admit | a non-Tagma run is not recognized |
| `callEnvelope` | duration or `none` | stall threshold ([[0f8d8726]]) | a run of this transport never ages into `stalled` |
| `ends` | set: `answer`, `interrupt`, `idle` | adapter, thread row | the row names which run end Tagma may not see ([[a621fbb3]]) |
| `feed` | `full`, `turns` | thread row | the row names the feed's completeness |
| `law`, `touch`, `authorship` | as `proves` today | thread row | the row names the weakening |
| `usage` | `measured`, `partial`, `none` | cost, budget | the cost names unmeasured runs |
| `aside` | `request`, `session`, `none` | recap, "Generate title" on a warm copy | no automatic recap; manual recap retells the journal, and `/recap` shows the cache state; the title goes by excerpt ([[45d13bf3]]) |
| `guidance` | `system`, `prompt`, `hook` | the guidance channel (below) | — |
| `screen` | `true`, `false` | the app surface | — |

A `transport-cannot` refusal carries the capability name and the transport, and its unblock names a transport holding the capability ([[0f8d8726]]).

A capability may depend on the model choice: `pictures` on native is the chosen model's vision, on `acp` the agent's `promptCapabilities.image`.

## Shared by every opening

- **Landing hold and budget.** `RunAdmission` and `spendable` are checked by the scheduler at every opening on any transport. Today's hosted run bypasses the hold (`RunLifecycle.ts:286`), and only the ACP driver checks the budget. The single exception is `observed`: that run is already going outside Tagma, and it can be neither delayed nor rejected.
- **Cost.** The budget counts measured cost. At a transport with `usage: none` cost does not grow, and the thread row names the budget unmeasurable. A run's cost is written with the choice's provider, and `harnessSpend` sums over it, as today.
- **One owner per server** — `ThreadOwner.id`. It holds both run leases and adapter resource leases. Today outside sessions carry their own random `ownerId` per process (`external-harnesses/assembly.ts:221`) next to the run owner, two independent leases of one run.
- **Fate of sent words** is decided per adapter by the write receipt, as ACP does today: `Unwritten` → `returned`; `Admitted` or `Unknown` with no reading evidence → `unconfirmed`, and words are never repeated. On the terminal the receipt is the host's answer to printing (`typeHarnessWords`). A `launch` fiber death also ends in a fate by the last receipt, never in silence.
- **Launch failure** — words not written: the process did not start, the host refused printing. The run ends `failed` with the `launch` cause, the words return, and follow-up wake retries it. Two such failures in a row stop the wake: the words stay queued, and the thread row says launch is blocked. Any explicit act — a new word, `continue_thread` — resets the counter and retries. A refusal awaiting human action (account, CLI login, model) is reported by the adapter as `refused(run, lasting)` and stops the wake at once: no second doomed launch, no second parent report. That is today's ACP driver rule (`refusals ≥ 2`, `protocol/process.ts`), moved into the core for every adapter. Without it an unreachable CLI would yield an endless row of failed runs plus a parent diagnosis each. Words written but unread are not a launch failure: the run goes on, and the CLI may read them later.
- **Unconfirmed words and the report.** Neither end's processed requests include items delivered without confirmation (today they do while the item is `delivered`, `collaboration/reporting.ts:99-107`). Such an item follows its reading: `fate(read)` moves it into the run where it was read, and the report leaves from that run.
- **Read deadline.** An unconfirmed item has a read deadline: on `acp` the profile's unresolved-prompt grace, on the terminal the profile window. The adapter measures it on its own tick or timer from the write moment kept in its row, and on expiry reports a `lapsed` report if no reading evidence exists; it reports a resource end the same way. Before that the adapter checks every reading evidence it has: on the terminal the transcript tail, where a marker of printed words means `fate(read)`, not expiry. The core closes the item with a "reading unconfirmed" cause and reports once to its sender. Words are not repeated: the sender decides whether to send again. A late reading of a closed item answers `settled` and writes no `signal` record.
- **Process exit** with an open run on any adapter: after a Tagma `interrupt` or when a human closed it — `aborted` with cause; otherwise `failed` with the process cause. What "closed by a human" means is declared by the adapter: on the terminal zero exit code, `/exit`, and a closed window (SIGHUP).
- **Writing words to the feed.** A user message holding Tagma words is written when the words reach the agent: on native at opening, on `acp` at prompt `Admitted` ([[e47bd3fc]]), on the terminal at accepted printing. Words from a launch that never happened never reach the feed.

## What the core gives the adapter

The contract splits by subject ([[2fcf2221]]). An adapter registers the subjects it supports, and composition checks them against the declared capabilities: a mismatch fails the build naming the adapter. No optional members inside one tag — that is the answer to `Harness`, with its ~35 members and 15 optional ones.

**`TransportRuns`** — mandatory.

- **`launch(run)`** — after the opening's commit, outside the lane and outside the core write.
  - Under its own lock the adapter writes into its row what it sends, then writes bytes or starts the loop. There is no separate intent in the core transaction: `running` run, inbox items delivered to it, and no send record in the adapter row is exactly "opened but not launched". A restart resolves it with `adopt`.
  - `launch` calls the opening write's `unit.afterCommit`, and `launch` puts the run in `holds` synchronously, before the first wait. There is no window between commit and handoff by construction, so on a live server an opened run never stands without `launch` and never ages with no sign of life before the first record. A `launch` failure before `holds` is a launch failure: words return, the run ends `failed` with the `launch` cause.
  - `launch` returns as soon as the send is queued. It must not wait for CLI readiness or process start: follow-up wake also calls it, and settlement subscribers queue (`ThreadRunSettlements.ts:33-44`).
  - Before a regular handover the server waits for running `launch` calls or cancels them. One cancelled before the send record is sent by the new owner; one cancelled after it but before the bytes becomes `Unknown` and is never repeated.
  - Idempotent by run id. An `observed`-origin run is never sent.
  - The `RunLaunch` input: run id and kind (`turn`, `keep-warm`, `compaction`, `continue`), model choice, seed, and two lazy handles — the `RunAssembly` build and the `RunGuidance` guidance.
  - The seed is the inbox items consumed in core order, framed by `queuedTurnText`.
  - Handles are read only by whoever needs them: the assembly by native and the Claude runner, guidance by adapters with a `prompt` channel.
  - `launch` has a deadline — for starting the process and the write. Words unwritten by the deadline are reported `fate(returned)` plus `ended(failed)` with the `launch` cause.
- **`deliver(run, items)`** — only at `steer: step`: readable records mid-run, also after commit.
- **`withdraw(run, item)`** — only at `withdraw`.
- **`interrupt(run, by)`** — end of execution. The end arrives as an `ended(aborted)` report.
- **`holds(runIds) → runIds`** — synchronously: which of the runs the adapter currently drives, i.e. its observation of the run's resource is alive. One core beater reads it.
- **`adopt(run)`** — after restart or handover. Answers today's `HostedResume`: `adopted`, `declined`, `ownership-lost`, `exhausted`, `stopped`. If evidence says the run ended while the server was down, the adapter first takes ownership (`adopted`) and then reports its end: otherwise the report would be cut as foreign.
- **`reached(run, mark)`** — waits until the adapter journal reaches the mark: a `callId` or "everything so far". On native and `terminal` it is identity. On `acp` with Tagma tools it is today's `HostedCalls.introduced` plus sealing before parking ([[ae10d61d]], [[3b671eda]]). Cause: two writers share one run — the protocol projection (model messages) and the core door (tool results) — and a result must not overtake its call.

**`TransportAsks.answer(question, answer)`** — carries an answer to a vendor question: an ACP `request_permission` answer, screen-widget keys, a hook decision.

**`TransportHistory`** — at `history: session`:
- `restore(thread, runIds)` — the journal returned the runs; a vendor session no longer holding them resets;
- `reset(thread)` — the vendor session no longer matches the journal (foreign compaction) and resets;
- `fork(source, child, cut, tx)` — inside the child-birth transaction (`threads/harness/births.ts`).

Rewind and Stop-with-withdraw are core acts over the journal, with no transport part. The next `launch` brings the vendor session to the journal by its own row's run-record difference ([[66a5c66e]]); cut and standing runs are served by the core through the `JournalRuns` port (`harness.runs.history()`). No "vendor cut, journal not" window exists by construction: the vendor cuts only after the journal, and a cut repeat is safe.

**`TransportCompaction.compact(run, instructions)`** — at `compaction: session`: squeeze in the vendor session (`_tagma/compact`).

**`TransportResource`**:
- `release(thread)` — finish the thread's process: on archive, delete, transport change, road change, and the idle policy ([[570382ca]]);
- `watch(threads)` — observe standing resource ends: by execution-host event, with no adapter timer for that observation ([[570382ca]]).

Native never registers it.

## What the adapter reports to the core: `RunReports`

- **Report shape.** Every report returns a write plan `(tx) => Effect` plus the table set it writes. The adapter executes the plan in its own write together with its row — as `HarnessJournal.prepare` does today. Composition unions the plan's set with the adapter's. Adapter state and core state commit together, while the journal, inbox fates, and transitions stay owned by the core.
- **Consistency.** The plan goes through `transitionIn` (`thread/transition/kernel.ts:149-159`): it takes no lane, and a race with a core act is decided by the row-version check and retry, as `HarnessTurnStale` does today.
- **Terminal acts.** `RunLifecycle.finish` and `stop` take the caller's write the same way `create` already takes `creation.tx`. Today `hostedLedger.end` runs in a separate transaction after the driver step, and the row holds `ending` until then. `RunClosing` already computes the end inside `decide(view, tx)` and writes the outbox row in the write's participants (`lifecycle/closing.ts:60-111`). Outbox wake goes on that write's after-commit.
- **Idempotency.** Every report carries the adapter's evidence: stdout position, hook-event id. The core keeps a bounded window of applied evidence per run, as the facet keeps the last receipts today (`observation.ts:142`), and the window dies with the run. A repeat is a no-op. A report on a finished run answers `settled` with a typed outcome and writes nothing.

Reports:
- **`observed(thread, opening)`** — a run began without the core.
  - Only a main-agent run-start event may open it: a prompt start or a call with no `agent_id`. A run end, a notification, subagent and background-task events never open a run.
  - The core opens a `turn` run of `observed` origin. Words, if any, become the user message, and the inbox is not consumed.
  - If a Tagma run whose words the agent has not read yet is open at that moment, that run is removed by the existing `stop` act with withdraw intent and no marker ([[7e9130bd]]), but with no `interrupt`: the operator's run occupies the process. No "interrupted" record exists.
    - Words unprinted: the run has no records, they return to the queue, and the empty run is invisible in the feed.
    - Words printed: the run's single record is the message holding them, and withdraw removes it (`withdrawnTurn`, `lifecycle/closing.ts:135-145`). The words stay delivered-unconfirmed: the CLI may have queued them and read them later.
  - Removing the Tagma run and opening the `observed` run are two acts of the [[7e9130bd]] table in one write, removal first: `withdrawnTurn` cuts history at the last message, and the new run's message must stand after it. Otherwise follow-up wake after the first commit would print waiting words into a CLI already running the operator's run. Today `RunClosing.close` and `create` are separate transitions, and two `transitionIn` calls in one write would fail on versions. So `RunLifecycle` takes a composite decision from both act bodies, and the implementer proves it with a test first.
  - Allowed only at `openings: core-and-observed`.
- **`recorded(run, entries, evidence, { reading?, tail? })`** — typed journal records ([[c3436715]]), durable movement for stall. It numbers no requests and carries no cost. `reading` is requestless reading (compaction), `tail` a snapshot of open parts for `streamTail` ([[8dd27b1e]]).
- **`measured(run, request, evidence)`** — a finished model request: cost plus context reading. The core assigns it `stepNumber`, writes `step-finished`, and seats it with the same owner as the native request ([[424c0878]]).
- **`retried(run, retry, evidence)`** — a request retry: a `retry` record, the `retrying` phase, and closing open inputs ([[8dd27b1e]]).
- **`fate(run, items, kind)`** — fate of delivered words:
  - `read` — the agent read them; the core writes a `signal` event. If the item was delivered-unconfirmed to another, already-finished run, the core moves it into the run where it was read, and the parent report follows it. Processed requests of the finished run do not change: unconfirmed items are not in them;
  - `returned` with cause — the word was not taken and returned to the queue;
  - `unconfirmed` — delivered without confirmation.
- **`lapsed(run, items)`** — the read deadline passed or the resource ended with no reading evidence. The core closes the items with one report to the sender. If the run they were delivered to is still going and holds no other records besides the message carrying these words, the core removes it with a `stop` act carrying withdraw intent, no `interrupt`: the next queued word goes as its own run. Removal requires no unread steers waiting past the run (`RunLifecycle.ts:155`). The terminal has none (`steer: none`); with an adapter holding steers such a run ends as an ordinary `aborted` with no marker.
- **`asked(run, question)`** — a vendor question enters `Questions` ([[fb39e560]]) keyed by the vendor call and carrying answer routes in `TransportAsks`. The run parks.
  - An answer not yet delivered to the vendor keeps the question open: a `Questions` question has an "answer given, not delivered to vendor" mark, and the `awaiting` stage and `openQuestions` count it. The `Questions` owner introduces the mark ([[fb39e560]]). Native never uses it, and today's `answering` — a short claim stage before resume (`ThreadInteraction.ts:264,361`) — is not overloaded.
  - Delivery is confirmed by `TransportAsks.answer`; the run end closes an undelivered answer together with the question.
- **`resolved(run, question)`** — the vendor decided the question itself: the same call's result arrived, or the question widget left the screen while Tagma printed no answer into it. The core closes the question as "decided outside Tagma", with the undelivered answer if one existed, and removes `awaiting`. Other calls' events never close the question: vendor calls run in parallel.
- **`ended(run, outcome)`** — the run end in the same write:
  - `completed` with the last message and `finish` — if the model ended on `length` or by refusal, the shared outcome judge with native makes that end `failed` ([[45d13bf3]]). With no message — with cause `end-unobserved`, if the end was derived by Tagma rather than seen ([[a621fbb3]]). Calls left without results are closed by the core with the same native-tail settlement (`threadTailEvents`, `unsettledCallEvents`), with cause "run end unobserved";
  - `failed` with a cause and, where the vendor gave one, the provider failure's typed class ([[45d13bf3]]), including process death with a live server;
  - `aborted` with `stoppedBy`. With no core stop request that is an observed interruption: the core places a stop with a marker, as the native reader's Esc. The closing writes the interruption row by the native rule only — on the run's open tail ([[45d13bf3]]).

  `cut` is never reported by an adapter: only the reaper writes it, when `adopt` refused ([[7e9130bd]]). The end carries the request-unreported cost remainder, the vendor's run cost ([[424c0878]]), and an aside copy on any outcome ([[f3949b43]], [[45d13bf3]]). Settlement subscribers — parent reports, follow-up wake — run after commit, outside adapter locks.
- **`reset(thread)`** — the vendor squeezed or cleared its own context (in Claude Code a `SessionStart` with `source: compact` or `clear`). The core resets delivered-guidance accounting.
- **`stepped(run)`** — the vendor reached a step boundary: all request calls' results returned to the model, the next request not yet started. On `acp` that is `ToolCallEnded` with no open calls left on the run; the driver judges it by state on that frame, not by the stdout portion's end, or a next request starting in the same portion would hide the boundary. For hosted tools the boundary is the same: the result returns to the vendor and closes the call; `ThreadHosting` reports no boundary, or the first of parallel calls would stop the run before the rest. The core answers it only when the run waits for a stop on the step (a model move between roads, an interrupt on step): then it places a stop with no marker, `by` the stop itself, and calls `interrupt`, with the end arriving as ordinary `ended(aborted)`. The report does not wait for that stop: the adapter sends it under its own lock, and `interrupt` takes the same lock, so the stop goes in its own core fiber. That is the same checkpoint native makes at a step start, and without it an on-step stop at an adapter would wait for the vendor run's end.
- **`live(run, delta)`** — into the core's live view, as entry deltas ([[c3436715]]). Text, reasoning, and a call's input join native's one open-parts machine `OpenParts` ([[8dd27b1e]]); the adapter gives their snapshot with the report plan (`tail`). The phase goes to `RunProgress`, which writes its own durable record on the write tick ([[424c0878]]). Before publishing parking and the end the core calls `reached` and seals the open parts.

## What the agent is told

Orientation at session start, team law, and recap for a new vendor session come from one graph owners (`graph/orientation`: `sessionStart`, `firstPrompt`, `touches.ts`). Only the moment and the accounting differ:
- native and the Claude runner decide on every model step with agent rules (`beforeStep`, `touchRule`), and write what was delivered as a `runtime-guidance` event (`AgentGuidanceJournal`). That stays;
- the `acp` vendor holds the whole law in the protocol row and builds the lead itself (`protocol/prompts.ts:100-116`, `opening.ts:164-174`);
- the terminal accounts with a `touchState` file in the hook's temp dir (`hooks/dispatch.ts:264-279,407-415`).

Tagma never sees the vendor's model step: guidance arrives only in a prompt or a hook answer. So the moment is a channel property, while accounting and writing are shared:
- The core's **`RunGuidance`** serves the `prompt` and `hook` channels. It answers what the thread is owed now: orientation at session start, team law, recap for a new vendor session.
- It writes what was delivered as the same `runtime-guidance` event in the thread journal as native. Accounting is an incremental per-thread projection reset by the context boundary: core compaction or a `reset` report. It never re-reads the journal per touch.
- Guidance counts as delivered once sent to bytes. An unresolved send counts as delivered: an ACP prompt cannot be repeated after `Unknown`. A hook-request repeat with the same event id gets the same text, or law recorded as delivered would vanish with a lost answer.
- The hook asks `RunGuidance` through the server instead of its own accounting file. `SessionStart` orientation precedes every run, so the accounting scope is the thread, not the run.

## How steps map onto runs

| Core act | native | `acp` | `terminal` |
|---|---|---|---|
| open | the `ThreadAgent` loop in `RunExecution` | `session/prompt` with seed | print at the prompt or process start with a prompt |
| run without Tagma | — | — | `observed` on the main agent's run start with no Tagma marker |
| step | step records | protocol updates → `recorded`, `measured`, `live` | `PreToolUse`, `PostToolUse` → `recorded`; requests from the transcript at run end → `measured` |
| word mid-run | the loop reads the inbox at the step boundary | `_tagma/steer` or `_session/steering`, echo → `fate(read)` | `steer: none` |
| question | `Questions`, parking | `request_permission` → `asked`; on the Claude runner the question is placed by `ThreadHosting` in `Questions` | `PermissionRequest` or a screen widget → `asked` |
| interrupt | abort signal | `session/cancel` | by profile: keys or process end |
| end | complete, fail | answer to prompt with `stopReason` | Stop hook or end evidence by the profile's `ends` ([[a621fbb3]]); process exit |
| restart | `adopt` = continuation from history | re-reading stdout from the cursor | lane to a live PTY plus end-evidence comparison |

## Lock order and recovery

- **Order:** the `ThreadHosting` semaphore → adapter lock → write. The core lane also precedes the write only.
  - The core calls the adapter only outside its lane and outside its write: `launch`, `deliver`, `interrupt`, `adopt` go after commit.
  - The adapter executes a report plan through `transitionIn` under its own lock, with no lane.
  - The adapter never waits for `ThreadHosting` under its own lock.
  - `reached` is called from `ThreadHosting` under its semaphore (`HostingQuestions.ts:62-70,108-137`) and takes only the adapter lock.
- **Recovery.** Only `adopt` raises a resource whose run the dead owner held. The adapter moves evidence cursors only after an accepted plan, so evidence refused as foreign is not lost. A runless resource is not raised by the adapter before the next `launch`, but its execution end is observed (`watch`).
- **Sign of life.** One core beater per owner: on every tick it asks `holds` of every adapter and beats all held runs in one write (`RunLifecycle.beat(runIds)`), as `RunExecution` does for native.

## What the adapter does not own

- decisions: steer, follow-up or a new run, follow-up order after Esc, the compaction barrier;
- the run id: the core issues it, the adapter maps its vendor-run id in its own row;
- run status, stage, stall, and ownership, plus thread life;
- questions: storage, parking, deadlines, approver, parent message;
- end, settlement, reports, and follow-up wake;
- journal and live-tail writes: the adapter gives typed records and deltas, the core writes;
- inbox-item state: the core applies fates;
- call judgment ([[22b5531d]]);
- rewind, fork, and compaction decisions plus the journal cut;
- delivered-guidance accounting;
- list, attention, and presence projections;
- model choice.

## What the adapter owns

- its process and its lifetime, including idling release ([[570382ca]]);
- the wire and its row: cursors, pending requests, the vendor session key, the vendor-run → run map, the send record;
- translating vendor events into typed reports and deriving the run end from evidence;
- the guidance delivery channel;
- executing launch, deliver, interrupt, and answer;
- recovering its process after a restart in `adopt`;
- declaring capabilities.

`Harness` keeps vendor facts unrelated to the run: birth and `spawn`, the vendor model catalog, installations, one-shot, `readerWords`, part of rollout. `retract` enters the core as an inbox act, `spent` as a run reading.

## Why this shape

- **Decisions with the core, execution with the adapter.** Word rules live in one place. Today `acp` copies `followUpAfterSettle`, and the terminal copies the queue claim on the Stop hook.
- **Opening with no intent in the core transaction.** The core commits the run, the adapter sends after. The protocol row's source of truth is the in-memory driver link (`ProtocolSteps.saved` writes the row from `link.row` without a version), and an intent write past that link would be overwritten, while a write under its lock from inside the core write would deadlock.
- **A report is a write plan.** The [[e47bd3fc]] atomicity (row, journal, and fates in one write before frames) holds, with the core as the journal, fate, and transition writer.
- **A capability snapshot in the row.** Decisions cost O(1), and what the core answers can never diverge from what the adapter can do.

Rejected:
- one interface with optional members — today's `Harness`;
- hosted as a fourth adapter: it is `acp` with a profile, and `ThreadHosting` is a core service;
- the adapter deciding under its own lock — a scheduler copy;
- `agentId` = the hosted agent: breaks the row invariants and every `harness` reader;
- continuation through a Stop-hook answer: printing follow-up at the prompt after `ended` gives the same result with one mechanism ([[a621fbb3]]);
- native guidance through `RunGuidance`: native decides on the model step the vendor lacks, and its mechanism already writes the same record.

## Acceptance criteria

- Composition test: an adapter whose subjects diverge from its capabilities fails the build with its name.
- `RunLifecycle` test: `finish` and `stop` in the caller's write commit with it, leaving neither an end nor an outbox row on rollback.
- Core-contract conformance on a fake adapter:
  - every report applies once, a repeat is a no-op;
  - a report on a finished run answers `settled`;
  - an adapter report not holding the binding is `foreign-binding`;
  - a run opened and never launched before a "crash" is sent once after `adopt`.
- Race tests:
  - `admit` against an adapter report on one thread — both apply, no hang (bounded wait);
  - steer and run end — the word returns and opens a follow-up;
  - `observed` against an open run: before printing, words return and the run is invisible in the feed; after printing, the run is withdrawn, words unconfirmed, and a later reading moves them into the run where they were read with the parent report leaving once — from it; the process is not interrupted;
  - an opening interrupted between commit and `launch` on a live server is still sent, and the run beats from the first tick;
  - unreachable CLI: two `launch` failures in a row, then the wake stands, words queued, the row names the block; a new word retries;
  - words written and unread before the run end: never repeated, reported from the run that reads them, or once on the read deadline or resource end; a later reading after that is `settled` with no second `signal` write;
  - a question the operator answered after the hook timeout and a human in the TUI: the same call's result closes it as "decided outside Tagma" with `awaiting` removed; a parallel call's result does not;
  - the read deadline expired but the transcript holds a printed-words marker: `fate(read)`, the run is not removed;
  - transport change against `observed` — one of the two, with no run on the old binding.
- Lock-order test: an adapter holding its lock reports to the core while the core delivers it a word and `ThreadHosting` waits for `reached`. No deadlock (fake clock, bounded wait).
- Recovery test: evidence arriving before `adopt` applies after it, not lost.
- Guidance test: on `prompt` and `hook` channels orientation and law deliver once per session, again after `reset` and compaction; an unresolved send is never repeated.
