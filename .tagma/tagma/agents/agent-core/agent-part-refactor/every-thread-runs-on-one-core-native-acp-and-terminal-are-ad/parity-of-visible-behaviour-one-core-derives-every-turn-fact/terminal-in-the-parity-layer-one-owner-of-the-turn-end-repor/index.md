---
id: 01a14cba-e095-7bcb-bb6f-6087f822dd50
title: "Terminal in the parity layer: one owner of the turn end reports requests and context reading from the transcript, the rest is declared weakenings"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a11c9a-6edb-7ed8-b517-60b0a621fbb3
  - kind: relates
    to: 01a14214-0718-7ed8-ac68-5e48f8ea396d
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/metadata/words.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/endings.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/events.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/terminal/watch.ts
---
Goal: a terminal thread on the core ([[a621fbb3]]) shows the visible facts of this work wherever hooks and the vendor transcript prove them. Where they prove nothing — a declared capability and a thread row, with no invented fact.

## As it was before this work

- **A turn ends four ways,** and only one knows the spend:
  - `TerminalWatch.check` on the transcript — with `spentSince`;
  - the Stop hook, `TerminalEvents.ended` — `reports.ended(run, ending)` with no spend; after it watch can no longer attribute spend: the `turn` is dropped ([[f8ea396d]]);
  - an accepted held answer, `TerminalEndings.held` — with no spend;
  - a next turn start with no Stop (`TerminalEvents.started`, the "previous turn unclosed" branch) — with no spend.
- **No reading carrier.** `claudeWords` (`metadata/words.ts`) places into `spent` every `assistant`-row spend, including subagents (`isSidechain`), and never decodes `message.model`. The main agent's last spend and its model are missing from `HarnessWords`.

## Solution

### One owner of the final measurement

Every confirmed turn end goes through one adapter owner `TerminalClosing`. All four paths above call it, plus the process end. It:
1. reads the transcript tail from `turn.offset` (`readHarnessTranscript`) outside `store.change` (`spent`): the hook path — before entering the record, from the row reading's facet, the process-end path — before the session-end record, watch — with its already-read tail (`measure`);
2. reports every main-agent request from that offset with a `measured` report ([[424c0878]]): the evidence is the vendor message id, the spend is `message.usage`, and the last one carries context reading;
3. reports `ended(run, ending, rest)`, where `rest` is the subagent-row spend (`isSidechain`) from the same offset.

An incomplete or failed transcript read writes no requests and no remainder but writes a warning: the turn end is not delayed by it. A repeated `measured` with the same id is a no-op, so a watch that re-read the same tail doubles nothing.

[[f8ea396d]] is the first cut of this owner, for the Stop hook. Its implementer makes the function shared by all four paths at once.

### The carrier in the transcript

`HarnessWords` gains `requests` — requests `{ id, usage, model, at, main }` by message id — instead of `spent`:
- `main` — the row is not `isSidechain`;
- `model` — the `assistant` record's `message.model`, which `claudeEntry` starts decoding.

`spentSince` goes away: `TerminalClosing` counts requests and the remainder.

**Context reading** comes from the main agent's last request:
- `usage` — its input and output;
- model and window — by `model` from the thread provider's catalog; a vendor id with a date suffix resolves to the catalog id, otherwise the reading would not match the thread model and warmth would read `cold`;
- `measuredAt` — the record time.

It carries no cache lifetime: `sentAt` and a promised TTL are not what the transcript proves. So warmth is not counted, keep-warm does not ping ([[7ecd38ad]]), there is no aside copy. A profile whose transcript carries no `usage` writes no reading and declares `usage: none`.

### Phases

A hook state machine, via `RunProgress` ([[424c0878]]):

| Event | Phase |
|---|---|
| adapter launches the CLI process for the turn | `opening` with the `process` reason |
| first main-agent turn event (`turn-start`, `activity`) | `null` — "working" |
| main-agent `PreToolUse` (`activity` with an open call) | `tools` |
| `PostToolUse`, `PostToolUseFailure` (`activity` with a finished call) | `null` |
| turn end | dropped |

Hooks prove no other phases: reasoning and writing read "working". Writers are `TerminalEvents` (`phase` after the turn start and every main-agent `activity`; subagent events never touch the phase) and `TerminalRuns.started` before the process launch.

### The rest

- **The "what was said" row** is the turn's final journal message ([[7ecd38ad]]).
- **Interruption** follows the native rule ([[45d13bf3]]): Esc in the TUI derived from the transcript, and a Stop hook with `status: aborted`, give `ended(aborted, reader)` with no core stop request — an observed interruption with a `marker` — but the terminal has no live tail, and the close writes no interruption row. That is part of the `feed: turns` weakening.
- **Failure** is the process or turn-end reason, with no provider class: hooks carry none.

## Declared weakenings

The thread row names them from the capability snapshot ([[0f8d8726]]):
- `feed: turns` — no live text, reasoning, call input, request retry and, therefore, no interruption row;
- `usage: partial` — requests and filling arrive at the turn end;
- `aside: none` — no warm copy: no automatic recap, a manual one retells the journal, and `/recap` shows "Cache state unknown"; "Generate title" goes via excerpt ([[db7ababc]], [[45d13bf3]]);
- `compaction: none`, `history: none`, `steer: none`, `modelMove: pinned`, `callEnvelope: none` — as in [[a621fbb3]].

`feed`, `usage` and `aside` capabilities are snapshot `TransportCapabilities` fields: native is `full`/`measured`/`request`, the `acp` profile declares its own, the terminal is `turns`, `usage` by the profile transcript's spend, `aside: none`. Rows born before these fields get them via a migration step.

Recap and keep-warm have no per-transport branch of their own: the automatic recap only launches from an aside report with a promised lifetime and a warm cache, and the terminal never reports aside nor reads warmth without a promise: it is `unknown` or a local estimate of the provider curve; a manual recap with no copy follows the journal road. So the proof for the terminal is a reading with no cache lifetime (`cacheWarmth` `unknown`/`none` in a world with no curve); the no-promised-cache recap and keep-warm roads are proven by their own tests regardless of transport.

## Acceptance criteria

The implementer proves on scripted hooks and a fake transcript:
- **every end path** — Stop hook, held answer, next-turn start with no Stop, watch on the transcript — gives the main-agent requests, the subagent remainder and context reading from the main agent's last request; requests plus remainder equal the turn's transcript spend;
- watch after a Stop hook never doubles spend;
- a subagent request never changes the reading;
- a profile with no `usage` in the transcript writes no reading, and the row names `usage: none`;
- phases follow the table, and after `PostToolUse` the row reads "working" again;
- no automatic recap, and a manual `/recap` writes a recap as a journal retelling;
- keep-warm never pings a terminal thread.
