---
id: 01a118eb-3e7e-7085-8f2e-2cd5c3436715
title: "Runtime-chat event model: closed decoded union, one settlement projector, entry deltas"
ord: 11
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/events.ts
  - kind: file
    ref: packages/agent/src/thread/persisted.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadLiveFeed.ts
  - kind: file
    ref: packages/agent/src/transcript/entries.ts
---
Goal: facts from runtime to chat have one canonical, decoded, closed model. Every fact — a call finished or failed, a run ended, what a thread is alive with and waiting for — is derived once, at its producer. Chat and Tagma only display it. This is the single place where the runtime→chat contract is set. The consumer side is the chat spec under [[cb732496]]: it points here and removes its own live-chunk projection, interrupted-part finalization, and run-end synthesis.

## Now

- `ThreadEventBody = { kind: string; payload }` (`events.ts:79-82`).
- `ThreadTranscriptEntry = { type: string; id: string; [key]: unknown }` (`transcript/rows.ts:1`).
- Ingress checks only the entry's `type` and `id` (`persisted.ts:20-23`), while the payload's typed edge is validated (`:101-136`). Consumers cast (`cap.ts:12`, `events.ts:398,409,496`, `ThreadToolRecords.ts:71`, `ThreadIntrospection.ts:483-511`).
- Tagma's projector casts raw SQLite JSON instead of decoding it (`native-harness/transcript/rows.ts:376-378`).
- Call state: `ThreadToolEntry.toolState: string` (`transcript/entries.ts:188`), while the union lives in `AgentMessageFold.ts:28-36`; producers write literals in at least eight places. The call-failure sign is also projected by `ThreadIntrospection.ts:506`, and chat derives it again from string prefixes.
- Run end. The ledger already closes tool tails (`threadTailEvents`/`unsettledCallEvents`, `ThreadRunLedger.ts:474-478`) and writes `run-end`. For a withdrawn run `run-end` is deliberately not written (`:481`), and fold drops its entries. Chat still synthesizes a third end from `latestRun` and finalizes interrupted parts itself.
- Two live streams to the client: `AgentEvent` chunks and entry deltas. The recorder already turns chunks into entries on the server, and the browser does it again via `AgentMessageFold`.
- The single seam for foreign parts, `ThreadProductTranscriptProjection`, is provided nowhere, and every unlisted `data-*` part is dropped (`ThreadStreamRecorder.ts:269-280`). Product entries (worktree carry and placement, transport change, composition) travel as open entries, and the client casts them.
- Live replay on a run is unbounded in bytes before the step commit and holds full tool payloads (`ThreadLiveFeed.ts:34-46,268-282`). Fan-out is synchronous and swallows subscriber exceptions (`packages/utils/src/event.ts:28-34`).
- Two-shaped readers in `persisted.ts:33-40,87-93` and soft failure aliases in `transcript/entries.ts:64-93` contradict [[acb620dd]].

## Contract

- **Entries.** A transcript-entry union with schemas, decoded on every ingress (core readers and the Tagma projector).
  - Validation is closed over the kinds installed at that ingress: core owns its kinds, the rest come from the registry.
  - An unknown kind is a typed decode refusal with diagnostics, not a silent drop.
  - The wire type keeps the kind-to-payload-type link.
- **Kind contributions.** A registry of event and data-part kinds: `{ type, schema }`. Every entry of an installed kind is journaled; there is no kind that lives only in the live tail.
  - The schema is carried by the producing module, and core names no variants ([[e090f46d]], [[6f758080]]).
  - Tagma product entries — worktree carry and placement, transport change, composition — are registrations of their server modules with typed members.
  - Core stores no renderer keys: that is the consumer's concern ([[cb732496]]).
- **Call state.** `ThreadToolState` is a closed union in `transcript/entries`. One settlement projector is the single place where completion, failure, and call outcome are derived.
  - A tool producer passes a typed domain-outcome marker in the shared result: success or refusal with a code. A Tagma operation adapter translates its typed refusal (e.g. `native-harness/voice/graphDisplay.ts:95-103`) into that marker. Core never looks for `status` and `code` in an arbitrary output; today every non-error result becomes `output-available` (`ThreadToolRecords.ts:37-38`).
  - Settlement separately keeps execution failure, admission refusal, cancellation, interrupted input, and unknown effect outcome (`agent/tool.ts:166-169`). None of them turns into success or a domain refusal for display.
  - Live feed, introspection, and chat read the projector's answer instead of parsing output.
- **Run end.**
  - Settlement closes every open part of the run and writes exactly one `run-end` per terminal run that recorded at least one entry. The ending comes from the [[7e9130bd]] table.
  - Withdraw is a removal: fold drops the withdrawn run's visible entries, keeping system-prompt entries under the current rule (`transcript/eventFold.ts:51-55`), and it has no `run-end`. The `withdrawn` ending reads from `RunStatus.ending` and the withdraw event, so the client returns the words to the draft.
  - Rewind marks entries instead of deleting them (`eventFold.ts:56-69`): the evidence stays for recovery while visibility follows the mark.
  - The client synthesizes no ends.
- **Live tail.** The open tail travels as incremental entry deltas with stable `entryNames` ids and order; `AgentMessage` chunks never go to the client.
  - Snapshot, durable position, and live watermark form one agreed cut — today's live sequence, journal position, and covered watermark (`transcript/live.ts`, `ThreadLiveFeed.ts:111-150`, Tagma `threads/list/feeds.ts`) persist in the new shape.
  - One `feedPosition` cursor, issued by the producer, covers durable entries and open-entry deltas. Snapshot and every delta carry it, and the client resumes from it. A gap past the producer's replay window is answered with a snapshot.
  - Replay after reconnect neither loses nor doubles changes.
  - Replay-budget overflow explicitly asks the owner for a resnapshot and never drops a fact.
  - Growing text travels by increment, with no re-send of the whole prefix on every token.
- **Waiting-input visibility.** The producer decides when waiting input (a queued turn, a steer before its agent read) is visible in the feed and where it stands. It publishes this with feed operations or open-tail entries. The client never hides a journaled steer and never synthesizes arrival rows from `occurredAt`. Today `ChatFold.svelte.ts:385-421` does (`entryFromArrivedWords`), and that is a second derivation of the fact.
- **Thread state.** `RunStatus` ([[9f3bb3f9]]) rides the snapshot and state events. Tagma's batched `threads.presence` feed over an explicit id set (the chat spec) is its clean projection plus a bounded open-entry delta.
- **Subscribers.** Isolated: a subscriber exception is a diagnostic — never swallowed silently, never breaking the rest.
- **Migration.** Stored old shapes migrate once with a store step, and the `persisted.ts` shims and soft aliases go away in the same change ([[acb620dd]]).

The feed transport envelope `thread.subscribe` and the presence feed belong to Tagma and the chat spec. They carry these types and never redefine them.

## Acceptance criteria

- Producer test: recorder deltas folded in order equal the run's stored entries — for a finished, failed, stopped, and withdrawn run. The consumer half (a session from deltas equals a session from snapshot) is proven by the chat spec.
- Test: every terminal non-withdrawn run with entries has exactly one `run-end`, and all its open parts are closed. A withdrawn run drops its visible entries and writes no `run-end` (system-prompt entries stay), and its ending reads from `RunStatus`.
- Projector tests:
  - a typed domain refusal yields a refusal with a code;
  - execution failure, cancellation, and unknown outcome keep their own states;
  - a successful output whose data holds `status: 'refused'` stays a success.
- `rg`: `toolState` is typed by a union, and no call-completion derivation stands outside the projector in the package and Tagma, while the Tagma projector decodes with no casts.
- Ingress test: an entry of an unknown kind yields a typed decode refusal with diagnostics, and a product entry of a registered kind decodes into its typed member.
- `persisted.ts` knows one shape; store migration is covered by conformance on both adapters.
- Owner's live-protocol tests:
  - a gap on the snapshot/live boundary;
  - a repeated replay with no doubling;
  - a missed delta is detected;
  - budget overflow leads to a resnapshot with no fact lost;
  - bytes sent scale with appended text.
