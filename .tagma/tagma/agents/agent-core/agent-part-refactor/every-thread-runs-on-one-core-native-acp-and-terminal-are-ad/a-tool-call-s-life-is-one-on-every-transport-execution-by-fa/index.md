---
id: 01a12685-91d6-74c9-bb18-016b7edf92bf
title: "A tool call's life is one on every transport: execution by fact, queue and admission as record fields, outcome from the executor, one 'what is going' in feed and list"
ord: 20
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/adapter-anthropic/src/runner/bridge.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/translate.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/phase.ts
  - kind: file
    ref: packages/agent/src/agent/AgentCalls.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadEffectSettlement.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadHosting.ts
  - kind: file
    ref: packages/chat-ui/src/ActivityStep.svelte
---
Goal: every tool call has one life on every transport. A call that does not execute never looks running. A queued call never looks like work. A running call shows what it does, how long it runs, and what controls it. Every call ends with a record carrying the real cause, and "did not execute" is written only where proven. A call executes at most once, and the operator's word interrupts waiting identically on every transport.

## What the user sees now

Thread 01a12660-dbc3-70fa-b84b-c55e56bcec26 (Claude on `acp`, 2026-10-10):
- "Running 2 calls" for minutes and "Running 5 calls" while one `bash` worked. "Reading a file" and "Searching a pattern" rows with no path or pattern.
- "Reading command output" for 8.5 minutes with no time, no buttons, an empty expansion. The model called the deferred `read_output` before `tool_search`, and Claude Code refused it itself (`No such tool available: mcp__tagma__read_output`): the call never reached Tagma. At run end the record got `output-unknown` "whether the effect happened is unknown", and the feed drew it as failed. That is false: the call never executed.
- Waiting on `read_output` with `wait: 140` shows as "Reading command output" with three icons. Which command it waits for, how long it waits, and how long the command itself runs are invisible. On native the same row shows the command label, "waited 1m / 2m 20s", "Stop waiting", and "Stop command".

## Defects

Each confirmed by reading the code along the whole chain. Thread records named where they exist.

### Call life

**D1. A call the vendor rejects before Tagma is dropped (`acp`, Claude runner).**
- The runner marks `_meta['tagma/executes']` by the `mcp__tagma__…` name (`runner/claude/translate.ts:156,203`), not by the fact that Claude Code invoked the MCP handler.
- The projection, under the "a Tagma call's outcome is written by hosting" rule ([[ae10d61d]]), ignores the marked call's `ToolCallEnded` (`protocol/projection.ts:147`).
- Hosting never saw that call (`Bridge.called` never entered), so the record stands `input-available` until the run end.
- That is how every Tagma call ends that Claude Code rejects itself: a deferred or unknown tool, schema-violating input, a call removed before send on cancel.
- A bare-name call (`bash` without prefix) records correctly — `output-error` "No such tool available: bash" (thread 01a12196-ee87-72ad-a4ce-dac5e973e4cc): it carries no mark.

**D2. After a server restart a Tagma call executes twice (`acp`, Claude runner).**
- `Bridge.called` repeats `call_hosted_tool` every second with no limit while the server does not answer (`runner/claude/bridge.ts:92-94`; `fault.data === undefined` is unreachability, `door.ts:91-92`).
- The new server recognizes the repeat only by the result in history (`ThreadHosting.performed`, `hostedReplay.ts`). `hosted.calls`, the `CallLedger`, and `AgentCalls` live in memory. So a `bash` running during the restart executes again.
- Hosting does not check whether this server holds the run: `call` takes `ledger.activeRun`, `committed` writes with no ownership check. A runner repeat may arrive before `adopt` and write into a dead owner's run.
- Without `claudecode/toolUseId` in meta, `Bridge.called` invents an `mcp-…` id (`bridge.ts:89-90`), and the hosting record diverges from the `tool_use` record.
- Note [[d0810682|on the runner]] says only `ask_user` repeats — the code contradicts it.
- Confirmed by code, not reproduced.

**D3. The queue is shown as execution.**
- Claude Code executes MCP tools without `readOnlyHint` one at a time; the message's other calls wait. In the thread above: `bash` 15:22:55.8–15:23:07.9, three reads started 15:23:08.17; a 35 s `bash`, and `glob` waited for it from 15:14:19 to 15:14:55.
- The runner declares every message `tool_use` as `in_progress` status (`translate.ts:166`), and the projection folds `pending` and `in_progress` into `input-available` ([[c5cc143d]]).
- Native has no vendor queue: `ToolExecution` executes a step's calls in parallel. But `AgentCall.run` sets `running` and `detachable: true` before `queue` — waiting on writes into foreign paths (`AgentCalls.ts:536-537`, `ToolExecution.ts:159-174`). So on native too a call waiting on a path is "running", "background" is available, and `limit` refuses "not admitted".

**D4. A call's start moment is recorded nowhere, and time is rendered three times.**
- Feed: a row clock exists only while exactly one call goes, and that is the run phase's time (`verdict.phaseSince`), not the call's (`ChatTranscript.svelte:505`, `ActivityStep.svelte:392`). At two or more only "run 5m 36s".
- Thread list: `ThreadPhaseFeed` sets `since: Date.now()` when the server first sees the record (`threads/list/phase.ts:98`) and lives in memory: after a server restart it is empty until the next record, and counting restarts from zero.
- The `AgentCalls` registry holds `startedAt` (opening) and `admittedAt` (admission) in memory, and the feed never reads its time.

**D5. Run end and Stop write "unknown" instead of the known outcome.**
- `unsettledCallEvents` (`ThreadEffectSettlement.ts:126`) closes every open call `output-unknown` "whether the effect happened is unknown" — even a call that provably never executed (D1).
- Stop goes `lifecycle.stop` → `transports.interrupt` → `sweep` (`RunExecution.ts:299-331`). The native loop races `abortWatch` and drops the step (`AgentRunner.ts:255-258`), and nobody records the door's outcomes, though it knows them: not-started is `cancelled`, waiting is "wait ended, untouched" (`answered`), started is `unknown` (`ToolExecution.ts:407-437`). Record: thread 01a113e4-a4f1-7a74-bbf0-2fb0f4393e01, #9463 `bash` (`sleep 20; …`) `input-available` at 11:08:49.237 → #9465 `output-unknown`, run `aborted` at 11:08:49.698.
- Hosting writes a call outcome without checking the run still goes (`ThreadHosting.ts:228-246`). A late `recorded` after the run end rewrites the record and appends a second result to history.
- The feed draws `output-unknown` as failure: `toolFailed` includes `unknown` (`chat-ui/activity.ts:276-278`), driving text color, dot, group error count, and folding. The registry meanwhile writes "Stopped" (`activityRows.ts:79-87`).

**D6. A hosted thread's model history loses the results the vendor gave.** The projection puts a tool-call part on every `ToolCallStarted` (`projection.ts:112-123,153`) but writes a vendor-finished call's tool result nowhere. `pairedForProvider` substitutes "The tool call did not finish: the run that made it ended first" (`toolPairing.ts:3,28`). That is how `WebFetch`, `WebSearch`, and — after D1 is fixed — Tagma-rejected calls look in `read_hosted_history` for a new Claude session and on a thread move to native.

### Waits and control

**D7. The operator's word does not interrupt waiting on a hosted thread.** `AgentRunner.run` subscribes `calls.listen` and `giveWay` to word arrivals (`AgentRunner.ts:205-217`); `AgentRunner.host` does not (`:156-163`). So on Claude via `acp`, `read_output` with `wait`, `wait_command`, `wait_terminal`, `wait_call`, and foreground `bash` hold the word until their own end (up to 10 minutes): Claude Code nests the steer only after the call result. Yet those tools' grammars promise the opposite: "The operator's words arriving for you end the wait early".

**D8. Stopping a call awaiting confirmation does not remove the question on a hosted thread.** `AgentCall.stop` in the `waiting` phase with no fiber immediately writes `stopped` (`AgentCalls.ts:298-302`), while `hostedAsks.confirmation` is unrelated to stop. Controls disappear, the question hangs, Claude Code waits for the MCP answer. Native closes the question via `door.callStops` (`ParkedQuestions.ts:105-113`).

**D9. The call limit contradicts the envelope.** The foreground-call envelope is 20 minutes (`CALL_ENVELOPE_MS`), and `expiresAt` shows it (`AgentCalls.ts:361-364`). A `limit` above 10 minutes is refused with "past that its envelope ends it first" (`AgentCalls.ts:389-394`) — false. `CallControls.svelte` substitutes 1200 s into the field, and "Set" is refused.

**D10. `wait_call` and `wait_terminal` have no display at call time** (`native-harness/contract/wire/operations/calls.ts:106-142`, `terminalCatalog.ts:459-486`). The row says "Waiting for a terminal" or "Waiting for an invocation" with no target, budget, or "Stop waiting". All transports. `awaitedCommand` understands only a command reference (`activityIdentity.ts:39-48`).

**D11. Waiting for a command never shows the command itself.** Even on native `WaitStatus` shows only the wait's own "waited X / Y". How long the awaited command runs and when its limit removes it are invisible, though the same command's own launch row shows them through `CommandStatus`.

**D12. Stop removes a run's background commands, though background calls survive Stop.**
- `AgentCalls.end(..., run)` removes only foreground (`AgentCalls.ts:164-170`).
- `sweep` removes commands by `createdRun` in any mode plus commands with `createdRun IS NULL` (`commandRows.ts:79-80,437-444`); a test pins it (`commandAdmission.itest.ts:2621-2642`).
- `DETACHED_DETAIL` and the `control_call` grammar promise background work belongs to the thread, not the run.
- Stop on an idling thread (`ending.ts:78-86`) removes all calls including background. The outcome depends on when Stop is pressed.

**D13. A background work's end never wakes an outside thread.** `wakeUnlessCold` answers `persist` when `harness !== null` (`threads/collaboration/signals.ts:26`). A native thread wakes, but Claude on `acp` waits for the operator's next word, though the model was told the notification arrives when the work finishes.

### Rendering

**D14. A Tagma call on `acp` has no display while running.** Native writes display at entry (`ThreadToolRecords.display`, `toolPartialDisplay`) and at preflight (`agent/turn/tools.ts:157-169`). On `acp` the projection writes the initial record with no display (`protocol/calls.ts` `openedEntry`), and hosting writes only the outcome (`ThreadHosting.recorded`). So there are no path, pattern, command. `activityIdentity` and `ToolActivity.awaited` cannot find the awaited command, and `WaitStatus`, "Stop waiting", and "Stop command" never render. The list row sees `title: null`.

**D15. "What is going" is rendered by three places, drawn differently.**
- Feed: `LiveRunRow` writes "Running N calls" from `feed.live.length` (`ChatTranscript.svelte:91-94`). That count includes running reasoning, compaction, and retry (`liveStatus.ts:23-36`), with no names or times.
- List: `workLine.ts` from `ThreadPhaseFeed` — first call, "+N", and time.
- Controls — from the registry.
- `chatThreadPhaseLabel` (`packages/chat-ui/src/activity.ts:181`) is called only by its test.

**D16. A dead second waiting mechanism.** `display.awaitsUntil` and `toolAwaitingMs` are read in `ActivityStep.svelte:166,170,341,374-377`, but there is no producer; only the schema (`tool/display.ts:69`) exists, and `OutputProjection.test.ts:201-206` demands cutting it. The working mechanism is `awaitsMs` plus `WaitStatus`.

**D17. The runner's prompt names tools that are not in the list.** `servedPrompt` (`bridge.ts:10-11`) says every tool named in the instructions is served as `mcp__tagma__<name>`. Deferred tools hide from `tools/list` until revealed (`ThreadHosting.ts:600-608`). Native answers such a call with the Tagma refusal "reveal it first"; `acp` answers "No such tool available" and — before this work — zombie D1.

## Decision

### Owners

| Fact | Owner | Stands where |
|---|---|---|
| a call exists, its input | whoever sees the model message: the native loop, the `acp` projection, the terminal `PreToolUse` hook | the journal `tool` record |
| Tagma executes this call | the Claude runner, on entering `Bridge.called` | `_meta['tagma/executes']` on the call end |
| a call waits or started executing | the executor: the Tagma door (`AgentCall`) for Tagma calls; the adapter for vendor calls by vendor evidence | the `tool` record's `execution` field |
| a Tagma call's display | the run catalog (`toolDisplay`, `initialToolDisplay`), one for native and hosted | `toolDisplay` of the record from the first record |
| a call's outcome | the Tagma door for Tagma calls (hosting writes it on `acp`); the vendor for its own and for calls rejected before Tagma; the run end only for the remainder, and "never executed" only on proof (item 5) | the outcome record |
| a running call's control and its related commands | the `AgentCalls` registry | `CallRecord`, `control_call` |
| what goes on in the thread now | the server's `ThreadPhaseFeed` — a projection of open records | `ThreadPhase`; the feed's summary row and the list row read it |

A feed row reads its record's fields; the summary row and the list read `ThreadPhase`; buttons read the registry. None of the three derives "whether it goes and how long" itself.

### 1. The runner marks Tagma execution by fact

- `Bridge.called` marks the call id on entry; `Translation` reads that set. A call with no `claudecode/toolUseId` in meta is rejected by `Bridge.called` with an error — no invented id.
- A Tagma call's `tool_call` goes out with `pending` status and, as now, `_meta['tagma/executes']`: the projection writes the initial record from it, not a vendor record.
- The end (`tool_result`) carries `tagma/executes: true` only if the call was sent to MCP, explicit `false` otherwise: the ACP machine replaces a call's `_meta` only with the frame carrying it, and an end without `_meta` would leave the start's mark. A `call_hosted_tool` refusal (except `run-not-held`) also yields `false`: the server never executed the call. Such an end is the vendor's end: the projection writes `output-error` with Claude Code's words (`No such tool available: …`, schema error), as for a bare-name call today.
- `WebFetch` goes `pending`, and becomes `in_progress` on the `PreToolUse` hook (`fetching.ts`) that authorizes it. `WebSearch` has no hook and goes `in_progress` with `tool_use`; other session MCP-server calls do the same.

The projection's "a Tagma call's outcome is written by hosting" rule stays ([[35a07ee2]] keeps it) but stands on fact, not on name.

### 2. `execution`: the queue and admission are positive record facts

- `ThreadToolEntry` gains an optional `execution` field:
  - `{ state: 'queued', reason?, gated? }` — the executor knows the call waits: in the vendor queue (`pending`), on writes into foreign paths; `gated: true` means the executor writes `started` before the call's work, so such a `queued` record at run end proves no work happened (item 5);
  - `{ state: 'started', at }` — the executor admitted the call to execution.
- No field means the executor said nothing. That is how records written before this change read, and how transports that stay silent read. No "waits" or "never executed" is ever derived from a missing field.
- An `input-streaming` record (arguments still arriving) is not a queued call; its row stays as now.

Who writes:
- **The Tagma door, shared by native and hosted.** The admission moment is one — `AgentCall.admit` (`admittedAt`). The door hands it to the call-record writer as the same value. `AgentCall.run` sets `running` and `detachable` at `admit`, after `queue`, not before. Until then the phase is `waiting` with a cause ("waits for writes to … to finish"), and the record takes `queued` with that cause. Background and `limit` become available at the same time.
- **Native.** `ThreadToolRecords` gains `execution(toolCallId, value)` by the same path as `display`: an open record takes the field in the live tail, the outcome record keeps `started`.
- **`acp`, Tagma call.** The projection writes the initial record `queued` with `gated: true` on any frame status: the vendor, not Tagma, executes it. `ThreadHosting`, after confirmation, `reached(run, { callId })` ([[ae10d61d]]), and `queue`, writes the record with `started` and the preparation display — a bare `committed(threadEntryEvent)` record, no `historyOf`, no step rules. The call's work starts only after that record commits; a record-write failure means the call never executes and answers with a refusal. The outcome `entryOf` keeps `started`. `ask_user` writes `started` before asking the question: an asked question is already an effect.
- **`acp`, vendor call.** `pending` is `queued`, the first `in_progress` is `started`.
- **Terminal.** The `PreToolUse` hook opens the record already `started`: the call starts at that moment (`terminal/entries.ts:19-31`).

`ToolDisplay.durationMs` ("took …") stays with the executor.

The `acp` cost: one small extra journal record per Tagma call, outside the hosting semaphore and step rules. The implementer measures it on a 20-call run and writes the number into the task.

### 3. A Tagma call executes at most once

- The runner repeats `call_hosted_tool` on unreachable server, as now: only that way does a call running during a restart get an answer.
- Hosting answers a call only for a run this server holds. Before the run is accepted by `adopt`, hosting waits for ownership within the `adopt` deadline, then answers `run-not-held`. The runner repeats that like unreachability.
- After `reached`, `ThreadHosting.performed` reads the call record pinpointly by its id, not the whole run:
  - `queued` — the call never started; execute it;
  - `started` without a result — the call executed in the server's past life. Hosting never executes it again; it writes the `output-unknown` outcome "Tagma restarted while this call ran; whether its effect happened is unknown — verify before repeating it" and answers with it;
  - no field (a record older than this change) — same as `started`: there is no proof the call never started.
- A repeat in the same server life joins the running fiber, as now (`hosted.calls`).
- `ask_user` and confirmations find their question by `toolCallId`, as now ([[fe7e09a3]]).

The invariant holding it: a Tagma call's work on `acp` starts only after the `started` commit (item 2).

### 4. A Tagma call's display on `acp` from the first record

- A Tagma call's initial record on `acp` carries the display its tool declares for the input — the same `toolDisplay` as native at input.
- The projection takes it from `ThreadHosting` with a `display(threadId, name, input)` member. It reads only the run's already-built assembly (`held`), with no hosting semaphore and no build: the adapter never waits for `ThreadHosting` under its own lock ([[2121a95f]]). The driver gets it as a `HostedDisplay` port and calls it synchronously when projecting a step. No assembly (after a restart `adopt` re-reads stdout before `open_hosted_turn`), an unknown name, or an input the display throws on means a display-less record.
- The `started` record (item 2) carries the preparation display (`initialToolDisplay`); the outcome record carries the outcome display.

So a queued and a running call carry path, pattern, command, and for `read_output` and `wait_command` the `reference` and `awaitsMs`. The same wait markup as native lights on `acp`.

### 5. A Stop and run-end outcome comes from the executor; "never executed" only on proof

- **Native.** On abort the loop does not drop the step: it waits for the running calls' outcomes within the stop grace, writes them via `ThreadToolRecords.settle`, pins the step with their tool-results into the model history, and only then closes the run. Door outcomes: not-started is `cancelled`, waiting is "wait ended, untouched" (`answered`), started is `unknown`. The grace is the stop-owner's constant with a cause: the door answers abort with no work, and the grace bounds only tools ignoring abort.
- **Hosting.** An outcome record is written only while the run goes: `committed` checks that in decide. A late outcome after the run end is never written, and the runner gets a "run ended" answer.
- **`RunClosing`** closes only calls the executor did not close:
  - `output-cancelled` "The run ended before this call started; it did not run." — only `queued` with `gated` (a Tagma call on `acp`): work there starts only after the `started` commit (item 2), so `queued` in the journal proves no work happened;
  - the rest is `output-unknown`, as now: terminal, vendor, a native call unanswered within the grace, records without `execution`.
- **`acp`.** The end the driver writes on `TurnEnded(cancelled)` (`RunReports.ended`) passes the same `RunClosing`.

**Feed.** `output-unknown` is not a failure: a neutral dot, `· outcome unknown`, outside the group error count and folding. `output-cancelled` is `· cancelled`. The registry keeps naming its act ("Stopped"): that is a different fact — who stopped, not what became of the effect.

### 6. A hosted thread's history carries the vendor's results

In hosted mode the projection writes a tool-result into `messages` for every call the vendor finished, not Tagma: `WebFetch`, `WebSearch`, and a Tagma call rejected before MCP. The result goes after the assistant message holding that call — in the same order `reached` gives hosting. The result words are what the model saw (the vendor's `content`). `pairedForProvider` no longer substitutes "did not finish" where a result existed.

### 7. Waits are identical on every transport

- `AgentRunner.host` subscribes `calls.listen` and `giveWay` to operator-word arrivals like `run`. The source is the core thread's inbox, which a hosted run serves in `AgentHostInput` as native serves in `signals.arrivals`. Unread means a word never delivered to the agent, plus a word delivered by steer with no `fate(read)`: Claude Code nests the steer only after the call result, so a wait starting after delivery yields too.
- A hosted call awaiting confirmation races `questions.ask` with `door.callStops([toolCallId])`, like native `ParkedQuestions`. Stop closes the question `cleared` with the stop cause, and the call answers with a refusal.
- `wait_call` and `wait_terminal` declare a call-time display with `awaitsMs` and a target reference. The target is not a command, so `ToolDisplay.reference` gains `call` (`runId`, `toolCallId`) and `terminal` (execution address) kinds. The row draws the `call` target from the registry — phase, time, limit — and the `terminal` target from its `ProcessLine`.

### 8. A call's limit is one, at its owner

- `AgentCall` publishes the largest limit that can be set now in the `CallRecord` (`limitCeilingMs`): 10 minutes for foreground, none for background.
- `expiresAt` shows the deadline that will actually remove the call: the set limit, else the envelope. `CallRecord.expiresBy` (`limit` | `envelope`) names which, and the button hint reads it.
- The background button is available only after `admit`. A call the model itself asked into background (`background: true`) answers with a receipt at once, even standing in queue, and executes at admission.
- The `limit` refusal text tells the truth: a foreground call gets at most 10 minutes; longer means background.
- `CallControls` substitutes at most `limitCeilingMs` into the field.

### 9. Background work and Stop

The rule is single: a run's Stop removes its foreground work — the run's calls and commands the run waits for with `commandWait.mode` foreground (the mode moves durably, `deliveries.ts:194-236`). Background calls and commands belong to the thread and survive Stop, as `DETACHED_DETAIL` and the `control_call` grammar promise. Their own button, archive, and thread delete remove them. A command with `createdRun IS NULL` is no run work; Stop leaves it alone. `EndingWalk.sweepRun` and `endHeldCommands` apply one rule; the `commandAdmission.itest.ts:2621-2642` test changes with it.

So decided the operator: background work is background precisely because it closes explicitly.

### 10. A background work's end wakes an outside thread too

`wakeUnlessCold` judges every thread by one rule: idle, last run `completed`, cache not cold → `wake`. The `harness !== null` check goes: there is no transport branch in `threads/` ([[9116e494]], criterion 2). The notification opens a run with the same follow-up wake as a word; how the adapter executes it is the adapter's business — on the terminal [[6232d2bb]].

### 11. Feed and list: one "what is going" from ThreadPhase

**`ThreadPhaseFeed`** is the only "what is going now" derivation:
- calls are the run's open `tool` records minus `input-streaming`; time is `execution.at`; `queued` counts separately;
- when it starts watching a thread it reads the run's open records — the live tail (`live.view`) and the run journal in one `entriesOfRun` read (the `ThreadList.serveOpenCalls` port, filled by native-harness) — instead of waiting for the next record; it also takes adapter journal records from state deltas. Events arriving during the journal read apply after it; after a server restart the list is truthful at once;
- the first-glance `Date.now()` goes away.

**A call row (`ActivityStep`)** reads its own record:
- `started`: pulsing dot, header and subject from display, its own clock `· 12s` from `execution.at`, registry buttons. No run-phase clock is drawn on a call row;
- `queued`: hollow dot, dimmed text, `· queued` (with cause if present) instead of a clock, no buttons;
- no `execution`: as now — going, with no own clock;
- awaiting a question answer: as now;
- finished: as now, with the item-5 outcomes; a call rejected before start shows as an error with the vendor's words.

**The summary row (`LiveRunRow`) and the list row (`workLine.ts`)** render "what is going" with one `standingWork` function (`packages/agent/src/transcript/entries.ts`, next to `toolStanding`). `ThreadPhaseFeed` puts its answer into `ThreadPhase` for the list; the feed has no `ThreadPhase`, so the summary row applies the same function to its `feed.live` open records. One formatting function `runningWorkText` from `packages/chat-ui` draws the answer: the longest-running call and its time, `+N` running, `N queued`. Example: `bash · 12s · +1 · 2 queued`. Reasoning, compaction, and retry never count as calls: they have their own rows. `chatThreadPhaseLabel`, the `runningCalls` row, and the `feed.live.length`-based "Running N calls" count are deleted. The `feed.live.length` count remains only a layout decision: exactly one live row carries the run clock instead of the summary.

**Command waiting.** A `read_output` / `wait_command` row with `awaitsMs` draws the target's `CommandStatus` next to `WaitStatus`: the command's time and limit (`4m 12s / 4m 40s`), `queued`, `stopping`, outcome. `ToolActivity.awaited` already holds the command's `ProcessLine`. So a wait shows that the target's own limit removes it before the wait ends. An open wait row's expansion shows the call input and the target's command line.

The wait row's expansion takes the target's command line through the optional `ChatToolStatus.detail` port.

**Dead code deleted:** `awaitsUntil` in `ToolDisplay`, `toolAwaitingMs` and its `ActivityStep` branches.

**`output-unknown` in the feed** is not a failure: the chat kit's `toolFailed` excludes it (the `@runlith/agent` producer keeps counting it as failure — door telemetry and introspection depend on that), the row does not fold.

### 12. Deferred tools at Claude Code

- `servedPrompt` tells the truth ([[d82432e6]]): tools in the list are named `mcp__tagma__<name>`. How to reveal a deferred tool is told only by the run context's `deferred-tools` section — and only where deferred tools and `tool_search` exist; `servedPrompt` never names `tool_search`: an agent with no grant for it has no such tool.
- Calling a deferred tool before reveal ends with Claude Code's words — after item 1 truthfully and at once. A Tagma refusal with a hint would require holding deferred tools' schemas in the list, and is rejected: deferral exists for exactly that.

### 13. Tagma-call parallelism at Claude Code

Native executes a step's calls in parallel, and the Tagma door orders same-path writes: `ready` from the call's position in the step plus `pendingWrites` (`agent/turn/tools.ts:183-198`). Hosted has no such order: `ThreadHosting.executed` calls `door.settle` with no `ready` (`ThreadHosting.ts:458-469`), and `queued()` with no `ready` passes at once (`ToolExecution.ts:159-160`). Today only Claude Code's one-at-a-time execution orders two `edit`s of one file in one message.

So parallelism switches on in two steps:
1. Hosting builds `ready` like native: call order from the sealed assistant message plus `door.pendingWrites`. It builds it after `reached(run, { callId })`: Claude Code starts a call before the message seals ([[00a81b23]]). An early call whose record already closed (Claude Code rejected it before MCP) never enters the order. An early call hosting prepared for another is removed from the door when its record closes without `started` (the vendor answered itself): `RunReports.step`, writing a closed `tool` record, publishes `ThreadChanges`. A closed record with `started` — a background receipt or a Tagma outcome — never releases the order: the writer holds the paths until its own work ends. A late call past an early writer awaiting confirmation gets "Same-batch path dependency … in the next step", as on native — before its own question.
2. Only then does the runner declare every Tagma tool to Claude Code as safe for parallel execution. Claude Code reads it from `readOnlyHint` (`bridge.ts:23`); `destructiveHint` stays truthful. That repurposes the annotation, so first a probe:
   - **P1.** On current `claude` and SDK (versions recorded), the runner with `readOnlyHint: true` on `bash` and `edit` under our options (`bypassPermissions`, `settingSources: []`, no plan mode). One message with `bash sleep 5` and three `read`s: the reads start at once. Plus a check that Claude Code changes nothing else by `readOnlyHint`: permissions, warnings, plan. The result is a #research block.
   - If P1 finds another influence of the annotation, parallelism stays off, and honest queueing (items 1, 2, 11) stands.

The operator decided: step 2 switches on after step 1 and P1, unless P1 finds the annotation influencing anything beyond parallelism.

## Layers

- `packages/agent`:
  - `transcript/entries.ts` (`execution`), `tool/display.ts` (`call` and `terminal` reference kinds, no `awaitsUntil`);
  - `agent/AgentCalls.ts` (pre-`admit` phase, `limitCeilingMs`, refusal text), `agent/AgentRunner.ts` (`host` listens to words; the loop on abort waits for outcomes), `agent/turn/tools.ts`;
  - `thread/run/ThreadToolRecords.ts`, `thread/run/ThreadHosting.ts` (`started` record, pinpoint dedup, ownership, `display`, `ready`, decide-time run check), `thread/run/hostedAsks.ts`;
  - `thread/run/RunExecution.ts`, `thread/run/lifecycle/closing.ts`, `thread/run/ThreadEffectSettlement.ts`.
- `apps/tagma/server/src/external-harnesses`: `runner/claude/{bridge,translate,fetching,door}.ts`, `protocol/{projection,calls}.ts`, `terminal/entries.ts`.
- `apps/tagma/server/src`:
  - `threads/list/phase.ts`, `threads/contract/wire/list.ts` (`queued`);
  - `threads/collaboration/signals.ts`, `threads/ending.ts`;
  - `executions` — the background rule at Stop;
  - `native-harness/contract/wire/operations/calls.ts`, `terminalCatalog.ts` (wait displays).
- `packages/chat-ui`: `ActivityStep.svelte`, `LiveRunRow.svelte`, `ChatTranscript.svelte`, `activity.ts`.
- `apps/tagma/app/src/lib/features/threads`: `workLine.ts`, `WaitStatus.svelte`, `CallControls.svelte`, `activityIdentity.ts`, `native/calls.feed.svelte`.

Notes [[ae10d61d]], [[c5cc143d]], and [[d0810682]] are rewritten by the same change that changes their code.

## Order

- Items 1 and 6 first: they remove the zombie and the false history and depend on nothing;
- item 2 is the basis for items 3, 5, and 11;
- items 4, 7, 8, 10, 12 independent;
- item 9 independent; item 13 step 1 before step 2, P1 before step 2.

## Out of scope

- `toolName` means different things per transport. ACP writes the vendor title into it, and `amendedEntry` changes it with the title (`protocol/calls.ts:185,230`). The runner gives a bare name, Devin a phrase, the terminal a vendor name (`mcp__tagma__read`). That drives `toolPresentation`, folding, and the list row. Disentangling each vendor's shapes is a separate task.
- Whether Codex and Devin send `PostToolUse` on failure (`toolFailure: undefined` in their rows). If not, their calls hang until the run end. A probe on a live CLI is needed — a separate task.
- Moving `acp` to the transport contract ([[35a07ee2]]): this work does not block it and finishes before it.

## Rejected

- The projection deciding "hosting never saw this call" from its own record state: it never sees HTTP calls to hosting and would guess by timing.
- The runner repeating only `ask_user`: a call running during a restart would get a transport error, the projection would drop its end with the `executes` mark, and the record would stand zombie until the run end. Repeat plus pinpoint `execution` dedup gives one outcome from one owner.
- "No `startedAt` means it never executed": false on the terminal, on a vendor with no `in_progress`, on native between flushes, and on pre-change records. So the queue is a positive field, and `cancelled` at run end only where the `started` record precedes the work.
- A `started` record only for `mutates` tools: long waits (`read_output` with `wait`) are not `mutates`, and without `started` they would stand `queued` their whole time.
- The feed taking time and "whether it goes" from the `AgentCalls` registry: vendor calls have no registry record, and the registry lives in memory and is empty after a restart.
- A new `ThreadToolState` state for the queue: `toolSettled`, settlement, and every state reader would change for what the `execution` field gives with no new branch.

## Acceptance criteria

The implementer proves:
1. A scripted ACP agent (`testing/acpAgent.ts`) and the `Translation` test: a Tagma call rejected before MCP yields `output-error` with the vendor's words at once, and its result is in the model history; a call sent to MCP is concluded only by hosting, with no second record. A call with no `toolUseId` in meta is rejected.
2. `ThreadHosting` test:
   - an admitted call writes `started` and the preparation display before the outcome and no earlier than its own assistant-message record;
   - a `started`-write failure means the tool never executed (a fake tool counts executions);
   - repeating a call with `started` or with no `execution` and no result yields `output-unknown` with no execution;
   - a repeat before `adopt` waits for ownership, then answers `run-not-held` after the deadline;
   - an outcome after the run end is never written.
3. Projection test: `pending` is `queued`, the first `in_progress` is `started`; a Tagma call's initial record carries display. The `HostedDisplay` port type (synchronous) holds that display never waits for the hosting semaphore; with no assembly there is no display — a `ThreadHosting.display` test (core).
4. Terminal test: `PreToolUse` opens the record with `started`.
5. `AgentCalls` test: a call in `queue` is phase `waiting`, `detachable: false`, record `queued`; after `admit` it is `running`, `started`; `limitCeilingMs` and the refusal text match.
6. Stop:
   - native: a stopped `bash` closes with the door's outcome (`unknown`), a never-started one with `cancelled`, a wait with `answered` "wait ended"; `RunClosing` writes only what the door did not close within the grace;
   - Claude on `acp`: a `bash` with `started` is `unknown`, a Tagma call with `queued` is `cancelled`; a terminal and vendor record with no proof is `unknown`.
7. Hosted-wait test: a word in the inbox interrupts a `read_output` with `wait`, with `WORDS_ENDED_WAIT` text, including a word delivered by steer before the wait starts; stopping a confirmation-awaiting call closes the question.
8. `ThreadPhaseFeed` test: call time is `execution.at`, `queued` counts separately, `input-streaming` and reasoning are not calls; starting to watch a thread immediately sees its open calls.
9. Wait-display test: `wait_call` and `wait_terminal` carry the target reference and `awaitsMs`.
10. Wake test: a background command's end wakes an idle Claude thread on `acp` like native.
11. Hosted record-order test (item 13 step 1): two `edit`s of one file in one message, executed simultaneously, apply in message order.
12. P1 recorded as #research with versions.
13. `rg 'chatThreadPhaseLabel|runningCalls|awaitsUntil|toolAwaitingMs'` is empty.
14. No touched file exceeds 650 lines without imports ([[6b3210c7]]).

## What the operator checks

Not a task-closure condition.
- Claude on `acp`: one model message with a long `bash` and three `read`s. Before item-13 step 2 the reads show `queued`; after, they go at once. Every running row carries its own clock and path.
- The model calls a deferred tool before `tool_search`: the row is red at once with Claude Code's words.
- `bash` in background and `read_output` with `wait`: the wait row names the command, "waited", the command's run and limit, "Stop waiting" and "Stop command" on `acp` as on native. The operator's word interrupts the wait on both.
- Stop mid-`bash`: the row is `cancelled` or `outcome unknown`, never red.

## Decided by the operator

1. **Background work closes only explicitly.** Stop, run interrupt, and run end never remove it; its own button, archive, or thread delete do (item 9). That is how Claude Code, Codex, and other agents behave.
2. **Transports move under one paradigm everywhere Tagma controls.** They diverge only where vendor behavior is beyond Tagma. So Tagma calls at Claude Code execute in parallel as on native: item-13 step 1, then step 2. Step 2 stays off only if P1 finds `readOnlyHint` influencing anything beyond parallelism.
