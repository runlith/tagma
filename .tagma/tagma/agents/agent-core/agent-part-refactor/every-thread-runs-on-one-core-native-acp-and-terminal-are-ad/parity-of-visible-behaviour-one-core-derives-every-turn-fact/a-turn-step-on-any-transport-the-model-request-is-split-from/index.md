---
id: 01a14cba-e095-7bcb-bb6f-6080424c0878
title: "A turn step on any transport: the model request is split from journal movement, one core owner derives the phase and per-request spend"
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60ad2121a95f
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/agents/startCard.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/meter.ts
  - kind: file
    ref: packages/adapter-anthropic/src/runner/spend.ts
  - kind: file
    ref: packages/agent/src/thread/run/assembly/openingPhase.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/RunReports.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadStepRecords.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadStreamRecorder.ts
---
Goal: turn phase, per-model-request spend, request-composition estimate and start card are the same on native and `acp`. Two core owners derive them, fed by one shape from the native loop and the adapter: `RunProgress` (phase) and model-request landing (spend, composition, request event). Journal movement is a third, separate concept: it never numbers requests and never carries spend.

## Now

- **Phase.**
  - Native declares it in the loop (`agent/turn/call.ts`, `AgentTurn.attempt`), `agentPhases` sets `since`.
  - `ThreadStreamRecorder` publishes `feed.progress` and writes the phase into `thread_run.progress` on flush. A flush also runs on a lone phase change, with no steps and no facts (`flushed`, the `phase === null` condition).
  - The `opening` phase with waiting words is published by another writer, `assembly/openingPhase.ts`, straight into `feed.progress` and never durable. It writes `estimate: null`, and `ThreadLiveFeed.progress` replaces the object wholesale.
  - The ACP driver never reports a phase: `LiveDelta` holds only `append | seal | close`. The chat shows a generic "working", the row list only calls.
- **The adapter `step` report is not a model request.** `ProtocolJournal.prepare` calls it for turn starts, boundaries, calls, guidance and fates. The prompt's `Admitted` receipt already gives `step` before the first request (`protocol/steps.ts` `landing`). A hosted turn's composition is written later, at `ThreadHosting.open`.
- **Spend.** Native adds the step spend when landing the step, after its tools: `AgentStep` is assembled after `runStepTools`, and `AgentStepIntent` carries no spend. On `acp` spend is added once, at the turn end (`RunReports.ended(…, spent)`). A live `acp` turn is invisible to the tree budget.
- **Spend units diverge.** On native and in `_meta['tagma/measured']` `inputTokens` is the whole input with cache. The `acp` turn-end counts spend as the `modelUsage` difference (`translate.ts` `spent`), where `inputTokens` is the input without cache, and `nonCachedInputTokens` is never filled (`projection.ts` `spend`).
- **Composition.** `ThreadHosting.open` writes a `compositionEntry` with no `tokens`, and only `ThreadStepRecords` on step 0 calls `pricedComposition`. `ThreadContext.attribution` is empty on `acp`.
- **The start card** subscribes to `ThreadStepObserver`, which only `ThreadStreamRecorder` publishes.

## Solution

### Three concepts

| Concept | What it is | Identity | Who writes |
|---|---|---|---|
| journal movement | any typed run records: words, boundaries, calls, guidance | the report evidence | native recorder; the adapter's `recorded` report |
| model request | one model request inside the step | `(run, stepNumber, attempt)` | the native loop; the Claude runner on the main agent's `message_start`/`message_stop` |
| step | a model request plus what it produced | `stepNumber` | the `step-finished` event in the journal |

- **`stepNumber`** is the count of the run's `step-finished` events in the journal at the request start. That is already native's count (`readThreadRunStepsTaken`) and the post-restart recovery. On the adapter the core assigns it in the report record, not the driver.
- **`attempt`** is the repeat number of the same request inside the step: on native the `ordinal` in `AgentTurn.step`, on the runner the `attempt` from `system/api_retry`. A repeat never grows `stepNumber`, so `retryEntryId(run, stepNumber, attempt)` is one on both roads ([[8dd27b1e]]).
- An adapter step is one main Claude Code loop request: its calls run after `message_stop`, and the next request is already the next step.

### Request landing — one owner

The core `RunRequests` service (`thread/run/requests.ts`) lands a finished request of any run in the caller's record. `land(run, request, tx)` answers the landing: the events the caller places into its own record, and `write(tx)` is its participant:
1. adds the request spend to the run (`usageIn`);
2. when the run has an unestimated opening `composition` and the request carries input, estimates it and writes `threadCompositionEvent`;
3. after commit publishes `RequestLanded { run, stepNumber, attempt, usage }` into the `landed` stream, which the harness exposes as `requests()` ([[e090f46d]]).

Called by:
- **native** — the recorder on flush after the `step-finish` chunk, with its `usage`. So the request spend grows right after the model answer, before the step tools. `ThreadStepRecords` still writes `step-finished` with the step messages, but no longer adds spend nor estimates composition. A step with no `usage` on `step-finish` lands with no spend, as today;
- **the adapter** — the `measured` report (below), which in the same step record writes `step-finished` with `context` and `usage` and the context reading.

Readers:
- `startCards` subscribes to `RequestLanded` with `stepNumber === 0`: the run's first request, which already has an estimated composition. A run continued after a restart (`stepsTaken > 0`) gets no card, as today.
- `ThreadStepObserver` with `AgentStep` stays only for `observeStepQuota`: the quota from HTTP headers is a native-provider fact. The Claude Code quota is reported by `_tagma/quota` in `AccountQuota`.

**Composition estimate.** The current rule splits the whole paid input across composition parts in proportion to their chars. On `acp` that input includes the runner's own prefix, which is not in the composition, and on native on step 0 the thread's old history. The rule changes to one for both roads: each part gets `chars / charsPerToken` of the run's model (`ThreadCompaction.charsPerToken`, as the start card does), and the rest of the paid input is a separate `rest` segment ("history and the agent's own prompt"). The visible change on native: the pill shows `rest` instead of inflated parts.

### Adapter reports

`AdapterReports` ([[2121a95f]]):
- **`recorded(run, entries, evidence, { reading?, tail? })`** — today's `step` under an honest name: journal movement. It never touches `stepNumber` and carries no spend. `reading` stays for requestless reads: compaction (`postTokens` or stale). `tail` is a snapshot of the open parts ([[8dd27b1e]]).
- **`measured(run, request, evidence)`** — a model request finished: `{ usage, reading? }`, the evidence is the vendor message id (`message.id` from `message_start`). The core assigns `stepNumber`, writes `step-finished` and calls `landRequest`. A repeat with the same evidence is a no-op.
- **`retried(run, retry, evidence)`** — a request repeat ([[8dd27b1e]]).
- **`ended(run, ending, { rest?, cost? })`** — `rest` is only the spend no request reported; `cost` is the vendor turn cost (below).

`ProtocolJournal.prepare` assembles `measured` from `usage_update` with `_meta['tagma/measured']` ([[c7d3d8a2]]) in the same driver-step record as `recorded`. A `usage_update` with no `tagma/measured` (Devin) gives only a window read into `recorded`, with no request.

### One `Usage` convention

Every spend in Tagma is `Usage` from `packages/llm` in the native convention: `inputTokens` is the whole input (`nonCachedInputTokens + cacheReadInputTokens + cacheWriteInputTokens`), `outputTokens` includes `reasoningTokens`, `totalTokens = inputTokens + outputTokens`. Whoever reads foreign units translates them:
- the Claude runner's `Meter` already writes `measured` in this convention;
- `Spend` translates the cumulative `modelUsage` (input without cache) into it itself;
- `spend` in `projection.ts` takes the fields as they are and fills `nonCachedInputTokens`. The runner's prompt-answer wire `Usage` follows the same convention: `inputTokens` is the whole input, cache its parts.

### Claude runner: turn spend

- `Meter` sends `usage_update` with `tagma/measured` on every main-agent `message_stop`, even when the window is still unknown: then `size: 0`, and the driver writes the request with no window read (`measure.ts` already reads `size` that way). Without this a request is lost today.
- `Meter` reports every sent request to `Spend` (`Spend.requested(usage)`). `Feed` gets `Spend` from `ClaudeSession`: both live in one runner session.
- On `result` `Spend` counts the remainder: the cumulative `modelUsage` difference in the Tagma convention minus the request sum, per field — `nonCachedInputTokens`, `cacheReadInputTokens`, `cacheWriteInputTokens`, `outputTokens`, `reasoningTokens`; `inputTokens` and `totalTokens` are derived. The remainder is subagents, mid-turn compression, inner calls and requests whose `message_start` was never read.
- When any remainder field is negative, the measurements contradict each other: no remainder, the requests stand, the runner writes a stderr line. `reasoningTokens` never enters that check and never drops below zero: Claude Code documents `thinkingTokens` in `modelUsage` as missing or partial. When the cumulative is unreadable or its start unknown (the first turn after resume and fork), there is neither remainder nor cost, and the turn spend is the request sum, with no false zero.
- The driver reads the answer `usage` as the remainder (`HarnessTurnEnded.rest`), the cost as `HarnessTurnEnded.cost`; both optional. A failed turn carries them in the failure `data` (`usage`, `_meta`), as the compaction answer does, and the driver reads them from there.

### `RunProgress` — one phase owner

A core service in `thread/run`, a record on the live run: `{ phase, since, waiting, estimate }`.

- **Input.** `enter(run, phase | null, { waiting?, since? })` and `estimate(run, estimate)`. The caller gives `since` only when it knows the start itself: `openingPhase` declares the wait after grace with the moment the wait started, and compaction with the run start. It sets `since` itself by the `agentPhases` rule: inside one "thinking" (`preparing`, `calling`, `reasoning`) `since` never resets. `agentPhases` moves here; the loop `phase` event carries only the name. `null` means "no phase, the run goes": the app shows "working".
- **Writers** — all through it:
  - `openingPhase` and `RunAssembly.native`: `opening` with the `graph` and `setup` waits;
  - the native loop via the recorder; `ThreadPhaseRecord` is removed;
  - the adapter — a `phase` kind `live` ([[2121a95f]]);
  - the terminal — via hooks ([[f822dd50]]).
- **Publishing.** `feed.progress` on every change, always the whole `ThreadLiveProgress` with the current `estimate`. It also owns `estimate`: the recorder passes it the `context-estimate`, and a phase change no longer wipes the estimate.
- **Durable.** An unwritten phase rides as a participant in the run's nearest record: native recorder flush, adapter report plan. The core drops it after commit. When no such record lands inside one `ThreadStreamRhythm.flushIntervalMs` tick, `RunProgress` writes `thread_run.progress` itself, in a separate record (`writePhase` changes only `$.phase`). That record never counts as movement for stall: run liveness is written by the beater, and a phase that moved the heartbeat would hide from the reaper a run abandoned right after adoption. Native's `streaming` stage is written by its first flush (the loop's first chunk plans it, including `phase`), so an adopted run leaves `resuming` as soon as the loop speaks. So a reload and a restart mid-long-opening, reasoning or retry-pause show the phase and timer from the run row.
- **Dropped** at the run end.

The phase dictionary is `AgentPhase`. The waiting-reason dictionary `WAITING_REASONS` moves from `native-harness/contract/wire/waiting.ts` to `threads/contract/wire/waiting.ts`: native harness, external transports and the app read it. It gains the `process` reason. The app (`app/.../threads/workWords.ts`) gains the "Starting the agent" words with the same change: without them `waitingWords` answers `null`, and the row falls into "Preparing the next step".

### The Claude runner phase state machine

The runner sends `$/tagma/phase { sessionId, phase }`, the driver turns it into a `phase` kind `live` ([[2121a95f]]). The `$/` method (the ACP live-notification space) is handed to the client as a `Signaled` event that neither closes the open message nor makes the step durable; a `_tagma/*` notification would do both on every phase change. Only main-agent events (`parent_tool_use_id === null`):

| Event | Phase | As on native |
|---|---|---|
| prompt handed to query (`isReplay` echo), tool result handed to the model | `calling` | `calling` before `models.open` |
| `message_start` | `calling` | new request, including after retry |
| `content_block_start` `thinking` | `reasoning` | `reasoning-start` |
| `content_block_start` `text` | `writing` | `text-start` |
| `content_block_start` `tool_use` | `tools` | `tool-input-start` |
| `content_block_stop` `thinking` or `text` | `calling` | `reasoning-end`, `text-end` |
| `message_stop` with no `tool_use` | `calling` | — |
| `system/api_retry` | `retrying` ([[8dd27b1e]]) | `retrying` |
| compression start (`status: compacting`) | `compacting` | `compacting` |
| compression end (`compact_boundary`) | `calling` | — |

After a `message_stop` with `tool_use` the phase stays `tools` until the result is handed to the model. A subagent turn never changes the phase: the main agent stands in `tools` meanwhile, as on native during a tool.

The driver sets `opening` with the `process` reason itself while the process starts or the session opens (`session/load`, `resume`, `new`), and `calling` on the prompt's `Admitted`. The runner has no `preparing`: it is part of the same "thinking", and `since` and the row cannot tell them apart.

### Cost — a run fact

The money cost the vendor reports is a run fact next to spend, with the same owner: `ThreadRunAccounting`. No cost surface lands in this work, but a future one will read one source on every transport. Users who pay per API call, not by subscription, need it too.
- **Where.** `thread_run.cost: { amount, currency, basis } | null` (`ThreadRunRow.cost`, the `writeCost` port); never on the wire (`SerializedThreadRun`) until a surface reads it. `basis` is what the sum means: Claude Code in `modelUsage` writes `costBasis` (in the [[77722519]] measurement — `list`, an estimate by price list, not a bill).
- **Who writes.** `ended(run, ending, { rest?, cost? })`. The runner places the turn cost into `_meta['tagma/cost']` of the prompt answer, as today; `Spend` counts it as the `total_cost_usd` difference with the `basis` from `modelUsage`. Cost is never split by request: Claude Code only reports it cumulatively.
- **The protocol row** no longer stores cost. One migration moves `protocol_turn.cost` values into their runs' `thread_run.cost` and drops the column ([[acb620dd]]), and `vendorOf` leaves. The value is kept, only its owner changes.
- **Native** writes `cost: null` until Tagma has a provider-price source; the terminal too — the transcript never proves it.
- **A side-question cost** (`aside.ts`) stays on the aside answer, as today.

## What is removed

- `ThreadPhaseRecord`, the `since` stamp in `AgentTurn`, the direct `feed.progress` in `openingPhase`;
- spend addition and `pricedComposition` in `ThreadStepRecords.events`;
- the `startCards` subscription to `steps()`;
- the `step` name in `AdapterReports`: movement is `recorded`, a request is `measured`;
- `WAITING_REASONS` in `native-harness/contract/wire`;
- `cost` in `protocol/row.ts`, `vendorOf` and the `protocol_turn.cost` column — after the value move into `thread_run.cost`.

## Acceptance criteria

The implementer proves:
- **Parity suite, phases.** A "reasoning → text → call → text" turn gives on native and scripted `acp` one phase sequence in `feed.progress`. The scripted agent sends the frames the real runner produces by the table above: the runner's contract test checks this, not the suite.
- **Durable phase.** A snapshot reload mid-long-reasoning and mid-retry-pause (fake clock) shows the phase and `since` from `thread_run.progress` on both roads. A server restart mid-`opening` with the `process` reason — too.
- **Estimate is not wiped.** A phase change after a `context-estimate` keeps `estimate` in `feed.progress`.
- **Spend.** After the turn's first request, before its tools end, the run spend equals the request spend on both roads. The `acp` turn end adds only the remainder, and per-`Usage`-field the request sum plus remainder equals the scripted agent's cumulative difference.
- **Request identity.** On scripted `acp`: a request, a repeat (`attempt: 2`) and the next request give `step-finished` with `stepNumber` 0 and 1 and a `retry` with `retryEntryId(run, 0, 2)`; a server restart between requests continues from 1; a repeat of the same `usage_update` after `adopt` never adds spend twice.
- **Composition and card.** On `acp` the composition is estimated on the first `measured`, not on the words record: the prompt's `Admitted` gives no card, the first request does. An operator root with a prompt above `agent.startShare` gets a card on both roads.
- **Runner** on a fake SDK: the event table gives `$/tagma/phase`; a `message_stop` with no window gives `usage_update` with `size: 0`; a remainder negative on one field is never written.
- **Cost.** A scripted `acp` turn end with `_meta['tagma/cost']` writes `thread_run.cost` with `basis`; the migration carries standing `protocol_turn.cost` into their runs with no loss and drops the column.
