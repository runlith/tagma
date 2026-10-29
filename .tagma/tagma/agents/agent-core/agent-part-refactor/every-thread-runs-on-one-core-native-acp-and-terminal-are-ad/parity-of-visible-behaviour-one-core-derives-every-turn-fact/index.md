---
id: 01a14cba-e095-7bcb-bb6f-607fe6ca4efb
title: "Parity of visible behaviour: one core derives every turn fact the user sees from adapter reports, and a missing fact is a declared capability"
ord: 21
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60ad2121a95f
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60ae0f8d8726
---
Operator: "for the user ACP must be indistinguishable from a native thread". The [[9116e494]] root gives one core and a transport contract ([[2121a95f]]), one meanings of states and acts ([[0f8d8726]]), ACP on the contract ([[35a07ee2]]) and the terminal on the core ([[a621fbb3]]). This spec is the layer above them: one core derives everything the user sees during and after the turn from adapter reports. Where the transport gives no fact, that is a declared capability with one answer and one wording in the thread row.

## Principle

1. **One owner per visible fact.** Turn phase, spend, request composition, call input, request retry, interruption record, failure reason, model-outcome meaning and the aside copy are derived by one owner in `packages/agent/src/thread`. The native loop feeds it the same shape as the adapter ([[51c66cb6]]). Today each of these facts is a native road the adapter lacks or duplicates.
2. **Identities are split.** Journal movement, the model request (`run`, `stepNumber`, `attempt`) and the step are different concepts with different owners ([[424c0878]]). Spend, composition, start card and retry id are derived from the request, not from journal movement.
3. **Readers never know the transport.** List, Peek, "Attention", keep-warm and cards decide by row facts and the capability snapshot. Branches on `harness`, `external` and the native step-observer subscription are removed ([[6f758080]]).
4. **No fact means no invention.** No fact is invented: the snapshot names it, the core answers with one refusal, the app draws no control ([[0f8d8726]]).
5. **Durable where the user leans on it after reload and restart.**
   - The phase is written into the run row by its owner on the write tick ([[424c0878]]).
   - Spend, retry, interruption, failure reason and composition estimate are written by their fact's record.
   - Open parts — text and call input before the message end — live in the tail, and their snapshot sits in `thread_run.streamTail` on both roads ([[8dd27b1e]]).
   - The vendor-session cut is derived from the journal, never held as a reserve ([[66a5c66e]]).

## What already stands in the code

Title. The Claude runner reads `ai-title` after every main `assistant` and `user` message and at the turn end (317d253a09). With no `threads.harnessTitle` Tagma names the external thread on the recorded turn start, as native on the first model answer (33f33ba413). Only the title model differs: an external thread is excerpted on a Title model, the provider's light model or a one-shot CLI call, not on the thread's warm cache ([[db7ababc]]). That difference stays, see below.

## What the user gets

| What is visible | native | Claude on `acp` | `terminal` | Part |
|---|---|---|---|---|
| turn phase: opening with waiting words, thinking, writing, tools, compacting, retrying, with a timer, after reload too | as today, durable and for opening too | same | opening and tools; otherwise "working" | [[424c0878]] |
| run tokens grow on every model request, before its tools; the tree budget sees them | earlier than today | same | at the turn end, `usage: partial` | [[424c0878]], [[f822dd50]] |
| context split: system prompt, tools, orientation, remainder | one estimate rule | same | no composition | [[424c0878]] |
| expensive-start card | as today | same | — | [[424c0878]] |
| request-retry record with a reason | as today | same | none, a weakening | [[8dd27b1e]] |
| call input grows while the model writes it, and survives Esc, retry and crash | as today | same | none, `feed: turns` | [[8dd27b1e]] |
| interruption row — by the native rule: `marker` on stop and an open tail; an observed Esc reads as a reader Esc | as today, unchanged | same | no row without a tail, a `feed` weakening | [[45d13bf3]] |
| failure with a provider class, HTTP and window reset | as today | same | process reason | [[45d13bf3]] |
| `length` or model-refusal end — a failure | as today | same | — | [[45d13bf3]] |
| copy for title and recap from the turn's first request | as today | same ([[77722519]]) | none, `aside: none` | [[45d13bf3]] |
| recap: automatic only on a warm copy with a lifetime, manual always, marked "Cache cold" or "Cache state unknown" | one rule ([[eba592c4]]) | same | manual only, as a journal retelling | [[45d13bf3]], [[f822dd50]] |
| the "what was said" row in the list, Peek, "Attention" | as today | same | same | [[7ecd38ad]] |
| keep-warm of a parent waiting for children | on a warm cache | same, on the CLI row quota | none: no lifetime reading | [[7ecd38ad]] |
| model and effort change mid-turn | the turn runs, the new one from the next | same, with no process restart | `model-pinned` | [[4010a731]] |
| rewind "from the turn" and Stop with withdraw | at once | at once; the vendor session is cut on the next launch | `transport-cannot` | [[66a5c66e]] |
| context reading and pill | on every request | on every request | at the turn end | [[f822dd50]] |

## Differences that stay

Each is recorded, and the user learns it one way.

- **The external-thread auto-title model** is an excerpt, not the thread's warm cache: there is no model of its own on the lower rung for an external thread in Tagma ([[db7ababc]]). The choice is visible in the title activity (`model-chosen`). With `threads.harnessTitle` the thread takes the CLI title — a setting.
- **The vendor process start.** The first turn after an hour of idle raises the process and does a resume ([[570382ca]], the operator's decision). Every runner process's first turn re-opens the query, about 0.6 s ([[d0810682]]). Reason: the SDK `query()` is an in-memory object of the process, and a turn survives a server restart only when the execution host holds the process ([[adb9cd5b]], decisions 2 and 3). The user sees the `opening` phase with the "Starting the agent" words ([[424c0878]]). Today it shows a generic "working".
- **A foreign summarizer mid-turn** compresses after the turn: the Claude Code session can only be replaced between its turns ([[92391518]], [[8cbd05a4]], the [[2dfc8bb6]] idea). A `/compact` answer is `requested` with `at: end`.
- **Turn activity on ACP** never sees the model's inner calls (`modelSteps: unobserved`, [[631f7e48]]). That is an activity record, not the feed: the feed gets phases and requests via [[424c0878]]. Their spend arrives as the turn-end remainder.
- **Continuation after `length`** — on native [[cc910981]] changes it inside the loop. On `acp` continuation belongs to the Claude Code loop, and Tagma only judges its outcome ([[45d13bf3]]).
- **Terminal:**
  - no live text (`feed: turns`, [[a621fbb3]]);
  - no steer, history or compaction (`steer: none`, `history: none`, `compaction: none`);
  - the model is fixed at birth (`model-pinned`, [[076a4c60]]);
  - no stall judgement, because no call envelope is proven (`callEnvelope: none`, [[5c2a4c31]]);
  - no retries and no provider failure class, no automatic recap and keep-warm ([[f822dd50]]).

  The thread row names them as `feed`, `usage` and `aside` capabilities.
- **Priority is Claude.** Devin and the terminal get the same contracts, and their parity items can land later with no design change. Devin gets no behaviour checks or fixes in this work.

## Layers

- **Core, `packages/agent/src/thread`.** Owners:
  - `RunProgress` — phase, `since`, waiting and context estimate, with a durable write on the tick;
  - model-request landing (`landRequest`) — spend, composition estimate, request event; journal movement is a separate `recorded` report;
  - `ThreadRunAccounting` — vendor turn spend and cost (`thread_run.cost`), with no surface in this work;
  - thread cache warmth (`threadCacheWarmth`, `cacheWarmthOf`) — one source for the list, `list_agents`, recap and the `/recap` marks;
  - `OpenParts` — open parts: text, reasoning, call input; the snapshot in `streamTail`;
  - run close — interruption, failure reason, model-outcome judge, aside copy;
  - the journal as the single truth about the history cut.
- **`external-harnesses/protocol`, the `acp` adapter** translates updates and `_tagma/*` extensions into these reports and brings the vendor session to the journal at `launch`.
- **`runner/claude`** translates SDK events into ACP. Tagma's dictionary (family and failure type, phase) is shipped by the runner itself: it is part of Tagma, and vendor knowledge stays in it. The HTTP-status rule is one `packages/llm` function.
- **`external-harnesses/terminal`** reports what hooks and the transcript prove, through one turn-end owner.
- **Readers** — `threads/list`, `native-harness/keepWarm`, `native-harness/agents/startCard.ts` — read the core facts and the capability snapshot.
- **The app** changes in three places:
  - the `/recap` item shows "Cache cold" or "Cache state unknown" from the row's `cacheWarmth`;
  - `workWords.ts` gains the `process` reason and takes the dictionary from `threads/contract/wire/waiting.ts`;
  - the pill shows the composition estimate's `rest` segment.

  The phase, failure reason, retry and call input are already drawn by it from native data.

## Neighbouring-spec edits in the same act

- [[0f8d8726]]:
  - `modelMove` on the Claude runner — `live` ([[4010a731]]);
  - the thread row also names `aside`;
  - recap on the terminal — manual only;
  - movement for stall — `recorded` and `measured`;
  - Stop with withdraw on the runner — a cut on the next launch.
- [[2121a95f]]:
  - the `aside` capability;
  - `recorded`, `measured`, `retried` reports instead of `step`;
  - `live` and `RunProgress`;
  - `ended` with `finish`, observed interruption, failure class and aside copy;
  - `TransportHistory` without rewind phases;
  - the `keep-warm` kind at `launch`.
- [[35a07ee2]] — the "History" paragraph and the projection's report names.
- [[9116e494]] — automatic recap only on a warm copy, manual on any transport.

## Standing work under and next to the root

- [[8180548b]] (the parity suite) stays: the parts' scenarios join its `parity.stest.ts` through the parts' work, not it.
- [[86d3a9ca]], [[6232d2bb]], [[b133508a]] stay: [[f822dd50]] is built after them.
- [[d38667ed]] stays: its keep-warm on runs is already in the code, and [[7ecd38ad]] removes the `external` gates.
- [[f8ea396d]] stays as the first cut of the terminal's single turn-end owner ([[f822dd50]]).
- [[cc910981]] stays: the continuation policy after `length` on native; the outcome judge [[45d13bf3]] derives is shared with `acp`.

out:
- [[00a81b23]] (`readOnlyHint` only changes Claude Code call parallelism): no visible difference from native. Hosted calls keep the record order via hosting `ready`, as on native ([[d0810682]]).
- Document and file attachments: both roads give the same text (`attachedDocumentText`, `attachedFileText`), pictures — by the `pictures` capability ([[2121a95f]]).
- The money-cost surface: there is none, and the [[424c0878]] run fact keeps the cost for a future one.

## Order

[[7ecd38ad]] — at any time. [[424c0878]] → [[8dd27b1e]]. [[45d13bf3]] — after the root's cut 1. [[4010a731]] — with the model-choice move into the core row (cut 1). [[66a5c66e]] — with the [[35a07ee2]] history. [[f822dd50]] — after cut 3 ([[a621fbb3]]).

## Acceptance criteria of the whole work

The implementer proves:
1. The parity suite ([[0f8d8726]], [[8180548b]]) carries each part's scenarios. Native and `acp` with a scripted agent give equal observations:
   - the phase sequence and the phase after reload;
   - journal records by kind: retry, interruption, provider-classed failure, interrupted input;
   - the turn spend by requests and the requests' `stepNumber`;
   - the estimated composition;
   - the start card;
   - the "what was said" row;
   - the title copy from the first request and the recap rule;
   - the keep-warm ping;
   - a mid-turn model change with no interruption;
   - rewind and Stop with withdraw with no process start;
   - the `length` and refusal outcome.

   The terminal gives what the table above declares.
2. Crash windows — the parts name them in their own criteria:
   - restart mid-opening and mid-retry-pause ([[424c0878]]);
   - mid-call-input with a live and dead process ([[8dd27b1e]]);
   - every rewind point ([[66a5c66e]]);
   - an effort change before a restart ([[4010a731]]).
3. `rg` finds none of:
   - `harness is not null then null` and `harness === null ?` in `threads/list`;
   - `external` in `keepWarm/driver.ts`;
   - `closingOf` in `protocol/journal.ts`;
   - `LiveTails`, `ThreadPhaseRecord`, `spentSince`;
   - the `startCards` subscription to `steps()`;
   - `thread-running` in `sessions/model.ts`;
   - `attendance.ready` and `row.rewind` in `protocol/`.
4. The runner's contract tests on a fake SDK — for every new mapping.

## What the operator checks

Not a close condition.

Two threads side by side — native on Anthropic and Claude on `acp` — get one sequence: a long `write`, a long `bash`, Esc mid-turn with a steer, a mid-turn model change, a rewind to the previous turn, a failed request. The phase row, tokens, pill, feed and list row look the same.
