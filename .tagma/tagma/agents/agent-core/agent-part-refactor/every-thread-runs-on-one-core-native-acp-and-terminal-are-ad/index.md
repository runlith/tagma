---
id: 01a11c9a-6edb-7ed8-b517-60ac9116e494
title: "Every thread runs on one core: native, ACP, and terminal are adapters behind the transport contract, with one meaning for the user"
ord: 37
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
  - kind: relates
    to: 01a113ff-0d62-74ec-ae7c-e91101dc1899
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cd1fb39e560
  - kind: relates
    to: 01a11c26-7d19-7b9a-8bcc-295722b5531d
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/contribution.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/collaboration.ts
  - kind: file
    ref: packages/agent/src/thread/transport/Transports.ts
---
Goal: a thread works under one set of meanings, however it was started — the Tagma native loop, a Claude runner on the Agent SDK, a vendor CLI over ACP, or a terminal CLI with hooks. Run state, its end, a question, queued words, the parent report, the feed, recovery after a restart — one core in `packages/agent/src/thread` decides and derives all of it. A transport is an adapter behind the core's contract: it runs the turn the core opened and reports facts about it. The core never branches on transport ([[6f758080]]), and whatever a transport cannot do, the core answers the same way on every transport.

## What the user gets

- One thread in the list, in `list_agents`, in presence, and in chat. `idle`, `working`, `awaiting`, `stalled`, and the `completed`, `failed`, `aborted`, `cut`, `withdrawn` ends mean the same on every transport, because one `RunStatus` derives them ([[9f3bb3f9]]).
- Enter, Tab, word recall, Stop, question answer, mode change, rewind, fork, compact, and model change are the same acts with the same answers. Where the transport gives no capability, the core answers with one typed `transport-cannot` refusal naming it, and the app never draws that control ([[0f144655]]).
- The parent gets exactly one report per run on every transport, from one settlement outbox.
- A server restart mid-turn continues work on every transport with one mechanism: the core's reaper and the adapter's `adopt`.
- Every thread has a feed in the core journal. So search, title, and the "said" row work even for a terminal CLI; automatic recap only over a warm copy with a known cache term, manual recap on any transport, with the cache-state mark ([[e6ca4efb]]).

## Now (at `aa90d197b6`)

Five roads, and a thread moves between them: native; `acp` with Tagma tools (Claude runner, `hosts: 'tagma'`); `acp` with vendor tools (Devin); `terminal`; `terminal` with an adopted CLI the human started themselves (`origin: 'adopted'`). Crossings are `set_thread_transport` (writes the `transport` journal entry) and model changes between roads in `HarnessMoves` (writes no entry, `threads/harness/moves.ts:58-139`).

**Native.** The core: single entry `RunScheduler.admit`, `RunLifecycle` transitions, lease and `RunExecution` launch, `runStatusOf` liveness.

**ACP** (Claude runner and Devin). A turn is the core's `thread_run`, but through side ports:
- `HostedRunLedger`, `ThreadHostedRuns`, `HostedAwaiting`, `HostedCalls`, `HostedHistory`, and the admit's `hosted` kind (`RunScheduler.ts:85,238-258`);
- the reaper and scheduler branch on `hosts(threadId)`, which means any `acp`, Devin included (`ThreadRunReaper.ts:196,213-214`, `RunScheduler.ts:364-367`, `threads/harness/hosted.ts:83`);
- a hosted run bypasses the landing hold (`RunLifecycle.ts:286`, `creation.hosted`);
- follow-up wake and opening a question at settlement are off for such threads (`unhosted`, `hostedRuns.ts:40-44`, `RunScheduler.ts:325-329`, `ThreadInteraction.ts:180`).

The driver itself decides steer, follow-up, and the next turn under its link lock (`protocol/inputs.ts:189-225`) and repeats the scheduler rules: "after Esc, steers first, like native `followUpAfterSettle`" ([[fb0b1868]]). The journal and the turn's live tail are written by a second writer — `threads/harness/turns.ts`: its own transition plan, its own open-part `streams` map, its own `contextReading` entry. Vendor questions sit in one `facet.question` slot.

**Terminal.** A thread has no core row, no journal, and no `thread_run` ([[e47bd3fc]]): the row for reading is synthesized by a LEFT JOIN (`native-harness/row.ts`), and writes to its log refuse with `externalLog`. A run is a process session, the run id is the session id (`sessions/drive.ts`), and `EngineStates.of` swaps the thread status for `sessionStatusOf` (`threads/harness/state.ts:64-73`). Beside the core stands a separate set of mechanisms:
- its own lease in the facet: `store.claim` and a heartbeat rewriting the facet every 5 s (`drive.ts:523-536`);
- its own work-state machine over hooks (`observations/work.ts`);
- its own delivery via the Stop hook (`turns/deliveries.ts`);
- its own `ReportEmitter` reports (`turnAnswered`, `asked` → `envelope:ask`, `sessionEnded`, an in-memory `announced` map) with its own meaning: a turn's answer is "the CLI's final answer", and it closes the parent request (`inbox.answered(…, true)`), while on native and `acp` a run-end report never closes the request (`collaboration/reportTexts.ts:4-11`);
- questions in `facet.question` with `hook` and `screen` sources;
- its own thread-entry status and process-time accounting (`store/sessions.ts:113-120`), its own keep-warm (`workingSessions`), its own metadata poll every 5 s per session (`metadata/harnessMetadata.ts`).

**Facades branch on the thread:**
- `withExternalRuns` (`threads/harness/collaboration.ts:208-272`): `stalledSince: null`, the run id is the session or thread id, keyed replay and `by` of externals lost;
- `ThreadTurns`, `ThreadAsks`, and `EndingWalk` pick the road by harness name (`threads/turns/acts.ts:76-102`, `turns/asks.ts`, `ending.ts:77-83,121-125,137-150`);
- `external-harnesses/contribution.ts` branches on `transport === 'acp'` in `queue`, `steer`, `unqueue`, `answer`, `cancel`, and `interrupt`;
- `SessionTransports` picks the driver by reading the facet on every call (`sessions/transports.ts:20-22`).

**A thread's model on `acp`** sits in `facet.asked`, while the core row holds `provider: 'external'`; selection reads through `HarnessRegistry.served` ([[076a4c60]]).

**Batch reads** `read_statuses` and `read_endings` answer `not-native` for any external thread (`native-harness/evidence/threadEvidence.ts:131-145`).

**Liveness is derived nine times:**
- `runStatusOf`;
- `collaboration/native/current.ts`;
- `withExternalRuns.running`;
- `sessions/current.ts`;
- `sessionStatusOf` inside the core itself (`thread/state.ts:46-60`);
- `list/summary.ts`: `summaryOf`, `moveOf`, `askOf`;
- SQL in `list/select.ts`: `activeSessions`, `asking`, `endedUnseen` via `json_extract` on the facet;
- `store/directory.ts`: SQL `life` and JS where `stalledSince: null` stands even for native;
- `rowLife.ts` in the app.

Already shared: journal entry kinds (`ThreadEntryKinds`), inbox and its constructors (`inboxSteerValues`, `inboxTurnValues`), `settleTool`, the judge and the mode registry.

## Decision

**The core is the single owner of:**
- the thread: every thread has a core row and a journal;
- run opening (`RunScheduler.admit`) and transitions (`RunLifecycle`);
- lease, handover, and recovery (`RunExecution`, reaper);
- queue, steer, stop, and withdraw;
- `RunStatus` with stall and ownership;
- questions (`Questions`, [[fb39e560]]) and approvals (judge, [[22b5531d]]);
- ends and the settlement outbox: reports, follow-up wake;
- rewind, branch, and compaction;
- the journal, live tail, and context reading;
- guidance delivered to the agent: one `runtime-guidance` journal entry per thread; native decides the moment at the model step, `RunGuidance` for the prompt and hook channels;
- the thread's model and agent choice.

**A transport is an adapter** under the [[2121a95f]] contract. Three adapters:
- **native** — the core's `ThreadAgent` loop in the server process;
- **acp** — the protocol driver. Its profiles: the Claude runner, which takes prompt, tools, and history from the core via `ThreadHosting`, and Devin with its own tools;
- **terminal** — PTY, hooks, and screen, with a per-vendor profile.

Five roads fit three adapters. The hosted road is `acp` with the `tools: tagma` profile; an adopted CLI is `terminal` with a shell resource. `ThreadHosting` is a core service, not a transport: the core hands it the run assembly, and the outside loop takes that assembly with `open_hosted_turn` and `call_hosted_tool` operations.

**Binding.** A thread's binding to an adapter is the `TransportBinding` in the core row. The core hands it to the `Transports` registry without reading `adapter` or `profile`. The `TransportCapabilities` snapshot sits in the same row and is read with it.

**The agent hosted by the Claude runner** is the binding's `agent` field. Today its id sits in `facet.hosts`. A foreign thread's `agentId` stays `harness`.

**Model choice** is a core thread fact on every thread: provider, model, reasoning in the core row, as on native. The adapter takes it in `RunLaunch`. `facet.asked`, `HarnessRegistry.served` with `selection`, and the `provider: 'external'` stub go away. With no second source of truth that [[076a4c60]] warns against: the facet never stores a model again. One adapter serves a provider (`claude-code` serves the Claude profile), so a model change that switches the serving adapter also switches the binding ([[0f8d8726]], the `modelMove` capability). One owner answers which adapter serves a choice — `HarnessRegistry.seating`; operator birth, spawn and fork birth, and model change seat a thread through it ([[076a4c60]]).

### Layers

- **`packages/agent/src/thread/transport`** — the contract: `Transports`, `TransportRuns`, `TransportAsks`, `TransportHistory`, `TransportCompaction`, `TransportResource`, `RunReports`, `TransportCapabilities`, `TransportBinding`. No Tagma imports.
- **`packages/agent/src/thread/transport/native`** — the native adapter over `RunAssembly`, `RunExecution`, and `ThreadAgent`. Composition registers it; core never imports it.
- **`apps/tagma/server/src/external-harnesses`:**
  - `acp/` — today's `protocol/` and profiles;
  - `terminal/` — today's `sessions/`, `hooks/`, `observations/`, and `asks/screen.ts`;
  - `runner/claude` — with no contract change;
  - vendor `vendors/*` rows — profiles for both adapters.
- **`apps/tagma/server/src/threads`** — Tagma doors (operations, feeds, list). They call the core without telling transports apart. `Harness` narrows to vendor facts that are not about the run: birth and `spawn`, the vendor model catalog, installs, one-shot, `readerWords`, part of rollout. The `HarnessJournal`, `HarnessRuns`, and `HarnessStream` ports and their `threads/harness/turns.ts` implementation go away: the core's `RunReports` does their work.
- composition registers the adapters in `Transports` ([[e090f46d]], [[edea5454]]).

### One word's path

1. A door calls `RunScheduler.admit`.
2. The scheduler in the thread lane decides: steer, follow-up, or a new run.
3. One core transaction writes the inbox and the run.
4. After commit, outside the lane — `TransportRuns.launch` or `deliver`.
5. The adapter under its own lock writes what it sends into its row and writes the bytes.
6. Vendor facts arrive in `RunReports` as a write plan the adapter executes in its entry.
7. The core writes the journal, inbox fates, and transitions, then publishes snapshot and live.

**Lock order:** `ThreadHosting` semaphore → adapter lock → entry. The core calls the adapter only outside the lane and outside its own entry. The adapter runs the report plan under its own lock via `transitionIn`, with no lane, and a row-version check settles races with core acts. The adapter never awaits `ThreadHosting` under its own lock. So there is no cycle ([[2121a95f]]).

## Branches that go away

| Place | Now | Instead |
|---|---|---|
| `RunScheduler.admit` | the `hosted` kind; `adopt(candidate, hosted)` | one `open`; the `adopt` of the adapter found by binding |
| `RunScheduler` follow-up | `unhosted(hostedRuns, followUp)` | follow-up wake for every thread |
| `ThreadRunReaper` | `hostedOf` → `hosted.resume` or its own road | `Transports.of(binding).adopt` for every run |
| `ThreadHosting.ts:635` | `hostedRuns.hosts(threadId)` | the contract's `reached` |
| `ThreadInteraction.ts:180` | `unhosted` mutes question opening at settlement | a subscriber for every thread |
| `RunLifecycle.create` | `creation.hosted` bypasses the landing hold | a hold for every opening; only `observed` bypasses ([[2121a95f]]) |
| `thread/state.ts`, `threads/harness/state.ts:64-73` | `sessionStatusOf`, `SessionFacts`; the terminal-thread status swap | removed: `runStatusOf` gives the status |
| `collaboration/births.ts:177`, `CollaborationVoice.ts:341` | `child.harness === NATIVE_HARNESS` decides the birth text and the model row | the text by the `messaging` capability, the model row from every thread's core choice |
| `native-harness/evidence/threadEvidence.ts:131-145,233-248` | `not-native` for externals in `read_statuses` and `read_endings`; ends per thread request | every thread, one read per page ([[570382ca]]) |
| `threads/harness/registry.ts:22`, `sessions/model.ts` | `served` and `selection` from the facet only on `acp` | model choice in the core row |
| `threads/turns/acts.ts:63-69` | the picture check only on native by model | the `pictures` capability |
| `ending.ts:96,102-113` | `sweepRun` (run commands and calls) only on native | core stop drops them on every run |
| `list/threadList.ts:398-448`, `ending.ts:121-127` | three archive rules: all sessions, resting only, `run` only | one rule by `RunStatus` ([[0f8d8726]]) |
| `store/sessions.ts:113-120`, `store/harnessFacet.ts:54-59` | terminal entry status, time accounting, and keep-warm by process | by runs on every thread ([[570382ca]]) |
| `journal/conversationReads.ts:374` | `journaledSession`: search with no terminal threads | every thread has a journal |
| `runStatusOf.openQuestionsOf` | only the `pendingInteraction` slot | `Questions` of every road ([[fb39e560]]) |
| `threads/harness/collaboration.ts` | `withExternalRuns`, `capabilitiesOf` by facet, a split `delete` | native `ThreadRuns` serves all threads; capabilities are the row snapshot |
| `threads/turns/acts.ts`, `turns/asks.ts`, `ending.ts` | `Harness` choice by name for send, queue, steer, unqueue, continue, answer, cancel, stop, archive, delete | core acts; adapter `release` on archive and delete |
| `external-harnesses/contribution.ts` | `transport === 'acp'` in six members | members leave `Harness`: acts go to core, execution to adapters |
| `sessions/transports.ts` | `SessionTransports` reads the facet per call | the registry by the core-row binding |
| `sessions/current.ts`, the `HarnessCurrent` type | the current run from the session | removed |
| `threads/harness/hosted.ts` | `hosts = transport === 'acp'`, the `HostedAwaiting`, `HostedCalls`, `HostedHistory` proxies | removed |
| `threads/harness/turns.ts` | the second journal, live-tail, and `contextReading` writer | the core's `RunReports` |
| `list/select.ts`, `list/summary.ts`, `store/directory.ts` | `terminalFacet`, `terminalSession`, `harnessAttention`, `json_extract` on the facet in life reads | run and `Questions` columns ([[570382ca]]) |
| `threads/turns/rewinds.ts:77`, `native-harness/compaction/context.ts:17`, `native-harness/context/actions.ts:62`, `native-harness/rows/native.ts:249` | `transport !== 'acp'` | the capability snapshot |
| `threads/harness/moves.ts:31` | `crosses = transport === 'acp' && hosts !== null` | the `modelMove` capability and the target binding |
| `threads/harness/births.ts:117` | journal only on `acp` | a row and a journal on every thread |
| `turns/deliveries.ts:31`, `turns/hookAdmission.ts:34,115`, `hooks/dispatch.ts`, `asks/decision.ts` | hook roles switched off by a `transport === 'acp'` check | the hook is handed to the binding's adapter; the `acp` adapter takes from hooks only touch and authorship roles (decision 5 in [[adb9cd5b]]) |
| the app `rowLife.ts`, `external/Surface.svelte.ts` | its own terminal-row life; surface by `transport` | `RunStatus` of the row; surface by the `screen` capability ([[0f8d8726]]) |

Inside the `acp` adapter, `link.profile.hosts !== null` checks (`steps.ts`, `prompts.ts`, `opening.ts`) become the profile's declared `tools: 'tagma' | 'vendor'` field. This is profile data; core never sees it.

## Parts

- [[2121a95f]] — the transport contract: what an adapter takes and reports, how steps map onto a run, what it never owns, capabilities.
- [[0f8d8726]] — one meaning for the user: states and acts across transports, answers to missing capabilities, the app surface.
- [[35a07ee2]] — ACP and the Claude runner on the contract.
- [[a621fbb3]] — the terminal CLI on the core.
- [[570382ca]] — reads, recovery, and scale.
- [[a63eba68]] — stored migration.
- [[e6ca4efb]] — visible-behavior parity over the contract.

## Order

Each cut changes the contract and all its consumers together and removes the shape it replaces ([[acb620dd]]).

| Cut | After | Does |
|---|---|---|
| 1. Contract; native and acp on it | [[a34152ed]] and [[7e9130bd]] in the scope already standing in code | `Transports`, `RunReports`, and the binding; the native adapter; [[35a07ee2]] with no vendor questions; `acp` row migration |
| 2. Vendor questions into `Questions` | [[fb39e560]] (task [[a5e5740d]]), [[4a024c48]] | `asked` and `TransportAsks.answer` on `acp`; the facet loses `question` for `protocol` |
| 3. Terminal onto the core | 1, 2 | first measurements T1–T5 in [[a621fbb3]], then the terminal on the contract with terminal-session migration and rollout steps |
| 4. Reads and scale | 3 | [[570382ca]]: list, `list_agents`, presence, and the app read `RunStatus` and columns; batched heartbeat; freeing idling processes |

Until cut 3 the terminal road stays as it is. This is the only time two shapes stand side by side, and cut 3 removes the old one.

Cut 3 is built ([[a621fbb3]], [[f822dd50]]), the old terminal road removed. The terminal-session migration step already folds into the base migration, so criterion 6 for the terminal on the base with its unfinished work no longer runs: a copy below the base refuses, and unfinished-work recovery is proven by the `adopt` and restart tests.

## Neighboring specs

- [[a34152ed]], [[7e9130bd]], [[9f3bb3f9]] — their contract becomes every transport's contract. `admit` loses the `hosted` kind and gains `observed`.
  - In [[7e9130bd]] there are no new acts: `finish` and `stop` take the caller entry like `create`; taking down a pushed run and opening `observed` are its two acts in one composite decision; `cut` is still written only by the reaper.
  - In [[9f3bb3f9]] the `stalled` threshold depends on the transport's `callEnvelope` ([[0f8d8726]]).
  - In [[fb39e560]] a question gains the "answer given, not yet delivered to the vendor" mark that holds `awaiting` ([[2121a95f]]).
  - In `collaboration/reporting.ts` handled end requests exclude unconfirmed items ([[2121a95f]]); this also changes native, which has no such items.
- [[fb39e560]] and [[4a024c48]] — vendor questions join `Questions`. This replaces their phrases that `facet.question` stays for vendor questions; same in [[7c54d3ed]].
- [[22b5531d]] — the judge unchanged; transport judges nothing.
- [[c3436715]] — adapters report typed entries and deltas of this model; the second journal writer goes away.
- [[01dc1899]] — the driver internals ([[16a4c8ac]]) stay. [[22a95947]] (splitting `HarnessTurns` into three tags) is replaced: those ports become the core's `RunReports`. [[8cbd05a4]] maps onto `compaction: session` capability.
- [[adb9cd5b]] — the hook-role, turn-as-run, and delivery decisions stand. `stop_agent` stops the core run on any transport; freeing the process is a separate act ([[e35a759f]], [[0f8d8726]]).
- [[076a4c60]] — the thread's model on `acp` no longer lives in `facet.asked`: choice is a core-row fact on every thread, and a road change never swaps `agentId` with `hosts`. The note is rewritten by the same change, as are [[e35a759f]], [[e47bd3fc]], [[fb0b1868]], [[fe977076]], and [[5c2a4c31]].

## Acceptance criteria for the whole work

The performer proves:
1. `rg` over `packages/agent/src` finds no hosted-kind admit, `ThreadHostedRuns`, `HostedRunLedger`, `HostedAwaiting`, `HostedCalls`, `unhosted`, `sessionStatusOf`, `SessionFacts`. An adapter id is compared only inside the adapter itself and in the composition registering it: no core, `collaboration`, or door branch depends on `NATIVE_HARNESS` or a transport name.
2. `rg` over `apps/tagma/server/src/threads`, `invocation`, `native-harness`, and `apps/tagma/app/src` finds no `transport ===`, `transport !==`, `terminalFacet`, `terminalSession`, `harnessAttention`, `harnessSessionActive`, `HarnessCurrent`, `withExternalRuns`, `answer_ask`, `cancel_ask`, and no `json_extract` on the facet in life reads.
3. The transport parity suite ([[0f8d8726]]) passes on all three adapters with a scripted vendor and shows the core's matching observations where capabilities match, and one `transport-cannot` where they do not.
4. The race tests from [[2121a95f]], [[35a07ee2]], and [[a621fbb3]].
5. The scale measurements from [[570382ca]].
6. The migration test from [[a63eba68]] on a base with unfinished work on all three roads.
7. No touched file crosses 650 lines without import ([[6b3210c7]]).

## What the operator checks

This never closes tasks.

- Four threads — native, Claude on `acp`, Devin on `acp`, Claude on `terminal` — take the same sequence: a word, a word mid-turn, Tab, recall of a word, Stop, a question with an answer. List rows and `list_agents` show the same states, with differences only where a thread row names a missing capability.
- A server restart mid-turn on each of the four: work continues, the feed has no repeats, the parent gets one report. The feed has no gaps on native and `acp`; on the terminal, tool calls that ran while the server was gone never reach the feed, and the thread row names that weakening.

## Decided by the operator

- A parent request is closed only by an explicit final answer on every transport; a run end, including a terminal-CLI turn end, never closes one ([[0f8d8726]]).
- A thread on `terminal` opens the terminal, as today, and the chat over its journal is an extra view behind a setting ([[0f8d8726]]).
- An idling `acp` process ends on a timer one hour after its last activity, background work included; a process with running background work never ends, and the next word raises a stopped one with a session resume ([[570382ca]]).
