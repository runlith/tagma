---
id: 01a14cba-e095-7bcb-bb6f-608245d13bf3
title: "The turn end writes the core close: interruption by the native rule, provider-classed failure, one model-outcome meaning, aside copy from the first request and recap only on a warm copy"
ord: 3
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a113ee-1dc0-7895-8b72-9ce9f3949b43
  - kind: relates
    to: 01a14743-437b-7fd2-9482-3351cc910981
  - kind: relates
    to: 01a14ced-642d-7b2d-b847-28f9eba592c4
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/commands/recap.commands.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/asides.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/journal.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/projection.ts
  - kind: file
    ref: apps/tagma/server/src/threads/recap/schedule.ts
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/closing.ts
  - kind: file
    ref: packages/agent/src/thread/ThreadFailure.ts
---
Goal: a turn end looks the same on every transport, because one core run close draws it (`lifecycle/closing.ts`). That is an interruption row by a rule, a provider-classed failure, one meaning of the model outcome (`length`, refusal), and a copy for recap and title at any outcome.

## Now

- **Interruption.**
  - Native: `RunLifecycle.abortedShape` gives an interruption only with a stop-request `marker`, and `decideEnd` writes it only inside `threadTailEvents`, that is, with a non-empty tail. The text is "Interrupted to deliver N steers" or "Interrupted by user": `threadInterruptionEvent` never reads `by`.
  - `acp`: `protocol/journal.ts#closingOf` writes `interruption` itself on every `aborted` turn, "by user" or "by agent", including on a model move.
  - An observed interruption — Esc in a terminal TUI (`terminal/watch.ts` `finishedBy`, `TerminalEvents.ended` with `status: aborted`) and a cancellation the vendor made itself — arrives as `ended(aborted, reader)`. `RunReports.ended` calls `lifecycle.stop` with `marker: false`, and there is no record.
  - A model move between roads (`carryModelMove`) stops the turn on the step boundary (`at: 'step'`, `by: 'model'`).
- **Failure.**
  - Native: `threadFailure` builds `ThreadFailureDiagnostics` from `LLMError`: `type` — the reason tag (`RateLimit`), `stage` — `module.method`, `httpStatus`, `retryable`, `modelStarted`, `rateLimit` (`HttpRateLimitDetails` with `retryAfterMs`), `reason` (`WireFailureRecord`). The feed writes "Run failed — Anthropic rate-limited (HTTP 429) · resets in 12m" (`runEndingLine.ts` reads `rateLimit.retryAfterMs`).
  - `acp`: `RunReports.ended` makes `new Error(reason)` from the reason string, and the diagnostics stay empty.
- **Model outcome.** Native counts `length` and `content-filter` as a failure (`AgentTurn.ts` `unsuccessfulFinish`). The runner maps `max_tokens` and `refusal` to `Stopped` (`translate.ts` `outcomeOf`), and the projection maps any `Stopped` except `cancelled` to `completed` (`projection.ts`). The same outcome is `failed` on native and `completed` on `acp`.
- **Aside copy.** Native places a copy on every request and hands it over at any end. `ProtocolAsides.kept` skips `failed` ends.

## Solution

### The core close writes the interruption

The operator's decision: the interruption row behaves everywhere as on native today; native does not change, the other transports follow its rule.

The native rule stays as it is and becomes the core rule for every run: an `aborted` run gets an `interruption` record only when its stop carries a `marker` and the run has a non-empty tail (`decideEnd` writes it inside `threadTailEvents`). The text is `threadInterruptionEvent`: "Interrupted to deliver N steers" when unread steers wait, otherwise "Interrupted by user"; `by` never changes the text. A withdrawn run gets no record.

Where the `marker` stands:
- a Tagma stop with intent to interrupt — a reader Stop, `stop_run`, `stop_agent`, rewind, delete, interrupt task — as on native today;
- **an observed interruption** — `ended(aborted)` from an adapter whose run has no core stop request (Esc in the TUI, a cancellation by the vendor itself): the same as a reader Esc on native, so `RunReports.ended` sets `marker: true` exactly in that case. When a stop request stands, its own `marker` decides;
- a model move between roads gives no row: it stops the turn on the nearest step boundary, and the stop on the boundary carries no marker. On native the boundary is the step start (`checkpoint`), on the adapter its `stepped` report: on `acp` it is the end of the last open request call. A turn waiting for a question answer already stands on a boundary: a step-stop ends it at once on both roads. Otherwise the move would wait for an answer the move's `RunAdmission` never lets in, until the window ends.
- an observed interruption with no adapter `stoppedBy` (the vendor cancelled the turn itself) ends `stoppedBy: reader`, as a native reader Esc.

The tail on `acp` is the same open-parts `streamTail` as on native: open text at the turn end stays a tail, and the core close lands it ([[8dd27b1e]]). So a Stop mid-text gives a row, and a Stop mid-tool with no open text gives none, as on native. Two things hold that tail until the turn end:
- `RunExecution.halt` on a run held by an adapter (not native and not starting) only asks for a stop (`live`) and calls the adapter's `interrupt`; the adapter's `ended` writes the end with the tail. A stop waiting for settling (`awaitSettled`: rewind, delete) waits for that end the same way native waits for its fiber. Before, the stop closed the run at once, and the close had no tail;
- a protocol-row change (`ProtocolReactor.persisting`, e.g. the `cancelling` mark) saves the client state without sealing the open message (`persist(…, false)`, `kept` in `@runlith/acp/client`), otherwise the cancellation would seal the text into the journal before the turn end and the tail would stand empty.

On the terminal there is no live tail (`feed: turns`), and an observed Esc gives no row — a declared `feed` weakening, not its own rule.

`closingOf` is removed: the adapter only reports `ended(aborted, stoppedBy)`, the core close writes the record. Native shows no visible change.

### The failure class goes into the existing diagnostics

`TransportFailure` is a named core schema next to `ThreadFailureDiagnostics` (`transcript/entries.ts`, the named-types rule). It is the part of the diagnostics the transport knows:
- `type` — the reason tag from the [[8dd27b1e]] table (a status with no table class is `statusReason` in `packages/llm/src/llm/schema/errors.ts`), the same value as on native;
- `stage` — where the vendor failed: on the Claude runner `claude-code.turn`;
- `httpStatus`, `retryable`, `modelStarted`, `detail`;
- `rateLimit` — `HttpRateLimitDetails`, with `retryAfterMs`;
- `reason` — `WireFailureRecord`.

`ThreadFailureDiagnostics` is composed from `TransportFailure` and what the core knows: `provider`, `account`, `retry`, `record`. `threadFailure` builds it with one function from native `LLMError` or from adapter `TransportFailure`. `runEndingLine.ts` and `TranscriptNotice.svelte` read the same fields and do not change.

A `failed` `RunEnding` carries `cause?: TransportFailure`. The Claude runner fills it at a failed turn end and places it in `_meta['tagma/failure']` of the prompt answer or in the error `data`:
- family and `type` — from the assistant's `SDKAssistantMessageError` and the result's `api_error_status`;
- `rateLimit.retryAfterMs` — from the last `rate_limit_event`, only with `status: rejected`: `rate_limit_info.resetsAt` (epoch seconds, as `sdk.ts` already reads it) × 1000 minus the failure moment, no less than zero; `sdk.ts` also starts reading `status`;
- `modelStarted` — whether the turn had a model answer (`message_start` of the main agent).

A classless failure — process, protocol, `Oversized` — stays a reason text: `type` is `ThreadRunFailure`, `stage` is `thread`, as on native with no `LLMError`.

### One meaning of the model outcome

`unsuccessfulFinish` moves from `AgentTurn` into the core `agent/finish.ts` module, called by both: `AgentTurn` and `RunReports.ended`.
- A `completed` `RunEnding` carries `finish?: FinishReason` (`length` or `content-filter`).
- The projection maps `Stopped max_tokens` to `completed` with `finish: length`, and `Stopped refusal` to `completed` with `finish: content-filter`.
- `RunReports.ended` hands `finish` to the judge: on error the run ends `failed` with the same text as native. The partial answer stays in the journal, as on native.

The continuation policy after `length` on native is changed by [[cc910981]] inside the loop. The final-outcome judge stays one: on `acp` continuation belongs to the Claude Code loop, and Tagma only judges its outcome ([[45d13bf3]]).

### Aside copy — from the turn's first request and at any outcome

- **Native** places a copy on every request's first answer and hands it over at any run end, as today.
- **Claude on `acp`** gets the session copy from the turn's first `measured`, not at its end. The [[77722519]] measurement showed: a live-query side question answers mid-turn — during a first turn's first request, mid-tool, and mid-streaming answer. It sees the turn's words, never delays the live turn, writes nothing to the transcript. `ProtocolAsides` offers the copy (`source: session`) on the turn's first `measured`, renews its lifetime on every next one, and hands it over with `ended` at any outcome. The `ending.status !== 'failed'` condition in `ProtocolAsides.kept` is removed.
- **The copy lifetime** is the last context reading's warmth ([[f3949b43]]).

The "copy on `acp` only at the turn end" difference leaves the root. "Generate title" during the first turn follows the warm copy on both roads.

### Recap: automatic only on a warm copy, manual always, with a cache-state mark

The [[eba592c4]] rule.

- **Warmth owner.** Whether the cache is warm, cold or unknown is a `threadCacheWarmth` fact over the thread's context reading — the same one the list row and `list_agents` receive via `cacheWarmthOf` (`threads/list/wire.ts`). Recap reads it, never derives it twice. `warm(aside)` in `recap/schedule.ts`, which today builds the same reading from the copy fields, is removed. A copy is always the last request's copy, so its warmth is the thread reading's warmth.
- **The automatic recap** is only planned when a copy stands and `cacheWarmth` is `warm` with a promised lifetime (`basis: promise`). With no copy (`aside: none`) or at `unknown` there is none — neither as a journal retelling nor otherwise.
- **The manual `/recap`** is always allowed except on a live run (`recap-running`, as today). It runs:
  - **on the copy when one stands** (a native capture or a Claude Code session), warm or not: a single request that rewrites the cache. `ThreadAsides` holds the copy until its cache lifetime ends, with no lifetime until the run ends. An `acp` session copy lives no longer than the vendor process that answers it: when the process ends (idle, crash, release, transport change), `ProtocolAsides` drops the copy. After that a manual recap retells the journal, and "Generate title" follows the cold excerpt road; aside never fails because the process is gone. The `recap-cold` and `released` refusals of the manual road are removed;
  - **with no copy** (native after a restart — `unavailable` today; `aside: none` on the terminal and Devin) — as a Tagma-journal retelling on the model picked by the same excerpt owner as the external title ([[db7ababc]]), with the same prompt and recap limits. Activity writes `model-chosen` with the `journal` road.
- **The app.** The `/recap` command menu item (`native/commands/recap.commands.ts`) shows in its `value` "Cache cold" or "Cache state unknown" from the thread row's `cacheWarmth`, which the app already receives. No separate confirmation (the operator's-authority rule): the mark shows before the press, the press launches the recap.

### The `aside` capability

The snapshot row ([[2121a95f]]): `request` | `session` | `none`.
- native — `request`;
- Claude on `acp` — `session`;
- Devin and the terminal — `none`.

It names in the thread row whether a warm road stands. The recap decision and "Generate title" read the fact itself — whether `ThreadAsides` holds a thread copy: a `none` transport never places one, so there is no automatic recap, the manual one retells the journal, the title is an excerpt ([[db7ababc]]). The `aside` field is not yet in the capability snapshot: it arrives together with the thread row's `feed` and `usage` ([[f822dd50]]).

Priority is Claude. Devin and the terminal get the same contracts, and their parity items can land later with no design change.

## What is removed

- `closingOf` and the `interruption` record in `protocol/journal.ts`;
- the `failed` condition in `ProtocolAsides.kept` and the end-only `acp` copy;
- `warm(aside)` in `recap/schedule.ts` and the manual-recap `recap-cold`, `released` refusals;
- `new Error(ending.reason)` as the single cause in `RunReports.ended`;
- `unsuccessfulFinish` in `AgentTurn.ts`;
- the "`Stopped` except `cancelled` is `completed`" branch in `projection.ts` for `max_tokens` and `refusal`.

## Acceptance criteria

The implementer proves with the parity suite on native and scripted `acp`:
- **Interruption.** Native behaves as before the work, `acp` as native: the same interruption record or its absence, and the record once:
  - Stop mid-text — a record;
  - Stop mid-tool with no open text — no record;
  - Esc with steer — "Interrupted to deliver N steers";
  - a stop by the agent;
  - a model move between roads — no record;
  - withdraw — no record;
  - a cancellation the scripted agent made itself mid-text with no Tagma stop (an observed interruption) — a record, as a native reader Esc.
- **Terminal.** Esc in the TUI and a Stop hook with `status: aborted` end the run `aborted` with `stoppedBy: reader` and no interruption record (no tail), and the thread row names the `feed` weakening.
- **Failure.** A 429 with a rejected `rate_limit_event` gives the same diagnostics as native: `type: RateLimit`, `rateLimit.retryAfterMs`, `reason.family: rate-limit`, HTTP 429 — and the same end-of-feed row.
- **Model outcome.** The scripted agent's `max_tokens` and `refusal` end `failed` with the same text as native `length` and `content-filter`; the partial text in the journal.
- **Mid-turn copy.** "Generate title" during `acp`'s first turn follows the session copy (`model-chosen` the `warm` road), as on native; the turn ends with no extra records.
- **Recap.** After a failed turn with a warm reading there is both a copy and an automatic recap. A copy with no promised lifetime: no automatic one. With no copy and `aside: none` (terminal): no automatic one, the manual one retells the journal.
- **Mark.** The `/recap` item shows "Cache cold" and "Cache state unknown" from the row's `cacheWarmth` (an operator check, not a copy test).
- **Runner** on a fake SDK: a result with `api_error_status` and an assistant with `error: 'rate_limit'` give `_meta['tagma/failure']` by table, `resetsAt` in seconds becomes `retryAfterMs`.
