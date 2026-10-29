---
id: 01a14cba-e095-7bcb-bb6f-60818dd27b1e
title: "One open-parts machine for native and adapters: the tool-call input grows and survives Esc, retry and crash, and the request retry is a record and a phase"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a10ba7-815e-7dbe-86e5-13e23b671eda
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code/session.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/runner/claude-code/translate.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/liveTails.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadHosting.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadStreamParts.ts
---
Goal: a model-request retry and a tool-call input the model is still writing read the same on `acp` as on native, and survive Esc, retry, crash and adoption the same way. Open tail parts on both roads are run by one core machine.

## Now

- **Retry.** Native writes a `retry` record (`ThreadRetryEntry`) and a `retrying` phase; the record survives reload. The Claude runner hands system messages to `Compaction.noted`, which reads only `compact_boundary` and `status`, and `system/api_retry` is lost.
- **Call input.** Native shows the call `input-streaming` with a partial display while the model writes the input: the loop computes the display (`agent/turn/call.ts`, `toolPartialDisplay` over `PartialJsonState`). On `content_block_start` the runner only remembers the id, ignores `input_json_delta`, and the `tool_call` leaves `Translation.assistant` with a finished input.
- **Native durable path of an unfinished input.** The recorder on flush holds the open input (`retainOpenInputs`) and writes a snapshot of the open parts into `thread_run.streamTail`. Esc and the end turn the open input into interrupted input (`finalFlush`, `tool-input-interrupted`), and the close after an execution loss lands the saved `streamTail` (`closing.ts` `decideEnd`: `threadTailEvents`, `unsettledCallEvents`, `settleOpen`). On the adapter `streamTail` is never written.
- **Two part machines.**
  - `ThreadStreamParts` lives in the recorder: it counts ordinals from the run records, places a sealed part into the recorder's fact queue, the feed itself never publishes.
  - `LiveTails` is a synchronous map in `RunReports`: a part keyed by the driver part number, `seal` keeps it visible until `landed`, the feed is published by it.
  - `ThreadLiveFeed.tail` replaces the run's whole open set, so a run can have only one publisher.
- **Hosted-call display** (`ThreadHosting.display`, the `HostedDisplay` port) takes only a finished input and marks it `complete: true`.

## Solution

### One open-parts machine

`OpenParts` (`thread/run/OpenParts.ts`) is the live view of one run's open parts. It is the part of `ThreadStreamParts` with no fact queue.
- **Key** — the journal record id the part will become: `assistantMessageEntryId`, `reasoningEntryId`, the call-record id. The machine user gives the id, because it is the key of its durable record:
  - native — by ordinals from the run records and `toolEntryId`;
  - the adapter — by the protocol-row part counters and `hostedToolEntryId`, as the projection.
- **Operations:** `open`, `append` (with text cleaning `appendClean`), `seal` (the part is finished and stays visible until landed), `landed(ids)`, `interrupt(callId)` (open input → interrupted input), `end`.
- **Publishing** — `tail(display)` gives the whole open set; the run's single publisher hands it to `feed.tail`: the recorder on native, the adapter tail in `RunReports` on the adapter. A run always follows one road, so two publishers never coincide.
- **Durable part write** stays with the journal writer of its own road: on native the recorder places the sealed part into its own fact queue, on the adapter the message is written by the projection. `OpenParts` never writes the journal itself.

`ThreadStreamParts` becomes a recorder wrapper over `OpenParts`, `LiveTails` is removed.

### Adapter `LiveDelta`

The core owns the type ([[2121a95f]]):
- `{ op: 'append', stream, part, text }`, `{ op: 'seal', stream, part }`, `{ op: 'close' }` — as today;
- `{ op: 'tool-input', callId, name, text }` — appended input text;
- `{ op: 'phase', phase, waiting? }` — into `RunProgress` ([[424c0878]]).

Partial-input display:
- the `HostedDisplay` port takes `PartialJsonState` instead of a finished input, and `ThreadHosting.display` returns `toolPartialDisplay(tool, reading)` — the same code as native;
- the adapter tail reads `readPartialJsonState` of the growing text and asks the display only when `completedFields` or `complete` change, as the native loop;
- the adapter passes the display function (`AdapterDisplay`, the driver projection takes its same type) at `RunReports.of(adapter, { display })`: `RunReports` never knows `ThreadHosting`; the projection hands a finished input as `completeJsonState(input)`;
- a vendor call (`WebSearch`, `WebFetch`, vendor MCP) has no display: the record shows the raw input text, as a native call with no display.

### Adapter durable input path

- **Where it is held.** One core machine holds an adapter run's open parts — the `RunTails` tail in `RunReports` (`lifecycle/runTails.ts`) over `OpenParts`; `live` deltas move it until the driver step is saved. There is no separate input list in the protocol row.
- **Snapshot for the core.** Every adapter report plan (`recorded`, `measured`, `retried`) writes the tail snapshot into `thread_run.streamTail` in the same record, without parts whose records already stand in the journal in that same record. The snapshot is written together with the protocol row, so it matches the stdout cursor. The core answers `tailDue(run)` once the tail changed and a `ThreadStreamRhythm.flushIntervalMs` tick passed since the first unsaved change; then the driver saves the step, and the journal writes `recorded` with no records for the snapshot's sake. After a step with live deltas the driver sets a timer for that tick (`ProtocolRuns.tailed`), so a short burst before silence is also saved.
- **Esc and turn end — as on native.** The `ended` plan writes the end's tail snapshot: open inputs in it are already interrupted input (the `interruptedInputEntry` constructor in `transcript`, called by both roads), open text and reasoning as they are; the core close (`decideEnd`, `threadTailEvents`) lands them as the native tail after `finalFlush`. The message the client machine drops at the turn end arrives with `closing: true`; on a turn ended by cancellation or failure the driver projection never writes it, and it lands from the tail. So the interruption row on `acp` is written by the close on the same rule as native — `marker` on the stop and a non-empty tail ([[45d13bf3]]) — and every record has one writer.
- **Retry.** `_tagma/retrying` travels the live stream as a `retry` delta in frame order: the tail puts aside inputs open at that moment, and `retried` closes exactly them as interrupted input with the retry reason, `stepNumber` and `attempt`, as `tool-input-interrupted` on native. A step's `measured` and `retried` reports on one driver go in frame order, so the retry lands on the request in progress.
- **Crash with no process.** `adopt` answers `declined`, the reaper cuts the run, and `decideEnd` lands `streamTail` the native way: text, inputs, `settleOpen`.
- **Adoption with a live runner.** The driver raises the link from the row and re-reads stdout from its cursor. Before `adopt` (adoption resets `streamTail`) it seeds the core tail with inputs from `streamTail` (`seed`, together with a partial-JSON reader over the prefix), while the client machine itself restores the open message — each part has one restorer. The snapshot was written in the same record as the row, so it matches the cursor, and deltas after the cursor append to it. The prefix is neither lost nor doubled; an adoption refusal closes the seeded tail.

The runner sends `$/tagma/input { toolCallId, name, delta }` — a live ACP notification (`Signaled`) that neither closes the open message nor makes the step durable on every delta:
- on `content_block_start` with `tool_use` — with an empty `delta`;
- on every `input_json_delta` — with the appended text.

The ACP client machine never takes this extension into the call state: `ToolCallStarted`, `_tagma/said` and the call fate do not change, and the `assistant` `tool_call` stays the journal's single call start. When it arrives, the input in the row drops, and `OpenParts` releases the part on the record's `landed` with the same id.

### Request retry

- **Runner.** `system/api_retry` → `_tagma/retrying { attempt, of, delayMs, family, httpStatus, message }` and `_tagma/phase retrying`. The family follows the table below. The mapping is vendor knowledge and lives in the runner.
- **Driver** reports `retried(run, retry, evidence)`; the evidence is the SDK message `uuid`. The runner places the next request's attempt number into `tagma/measured` (`attempt`), and `measured` lands the request with it.
- **Core** in one record:
  - writes `ThreadRetryEntry` with `retryEntryId(run, stepNumber, attempt)`, where `stepNumber` is the request in progress ([[424c0878]]);
  - writes the `retrying` phase durable;
  - closes the run's open inputs (above).
- The next `message_start` returns `calling`.

| `SDKAssistantMessageError` or status | family |
|---|---|
| `rate_limit`, 429 | `rate-limit` |
| `overloaded`, 529 | `overloaded` |
| `authentication_failed`, `oauth_org_not_allowed`, `cloud_credential_error`, 401, 403 | `auth` |
| `billing_error`, `account_on_hold` | `quota` |
| `invalid_request`, 400 | `invalid-request` |
| `model_not_found`, 404 | `no-route` |
| `server_error` and any unclassified status above | by the same rule native uses to classify the HTTP status |
| no answer (`error_status: null`, `no_response`) | `connect-timeout` |
| other | `unknown` |

The status rule is an exported `statusReason` in `packages/llm/src/llm/schema/errors.ts` (a shared door, with no transport executor): it builds the `LLMError` cause whose `_tag` is the type and `family` is the family; the executor and the runner call one function. The same table gives the turn-end failure class ([[45d13bf3]]).

## What is removed

- `LiveTails` and `lifecycle/liveTails.ts`; `RunReports` declares the `LiveDelta` type;
- `complete: true` in `ThreadHosting.display` and the finished input in `HostedDisplay`;
- the "only `compact_boundary` and `status`" branch as the single reader of the runner's system messages: `ClaudeSession.noted` hands subtypes to owners — `api_retry` to the translator, compression to `Compaction`.

## Acceptance criteria

The implementer proves:
- **Parity suite, retry.** A scripted agent with a retry gives a `retry` record of the same kind and id and a `retrying` phase, as native with a fake provider (529, then success). After reload the record stands.
- **Parity suite, input.** A call whose input arrives in three deltas reads `input-streaming` with a partial hosted-tool display until `tool_call`, then one durable record with the same id.
- **Parity suite, input outcomes.** Native and `acp` give the same interrupted-input record for:
  - Esc mid-input;
  - retry mid-input (the previous attempt's input closed with the retry reason, the new attempt opens its own);
  - process and server death mid-input (the reaper lands `streamTail`).
- **Parity suite, Stop mid-text.** Native and `acp` give one partial-text record from the tail and one interruption row ([[45d13bf3]]).
- **Adoption.** A server restart mid-input with a live runner: after `adopt` the tail carries the whole prefix, with no double and no gap, and the call ends with one record.
- **`OpenParts` unit test:** the open → append → seal → landed sequence gives the same open set on both users.
- **Runner contract on a fake SDK:** `api_retry` → `_tagma/retrying` with the table family; `input_json_delta` → `_tagma/input` in block order; subagent events send nothing.
