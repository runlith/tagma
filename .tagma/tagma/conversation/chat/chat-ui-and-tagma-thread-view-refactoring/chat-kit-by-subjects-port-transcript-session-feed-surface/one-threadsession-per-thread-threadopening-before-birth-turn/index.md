---
id: 01a118f1-5f59-7eb8-856a-a0e0eb9c2129
title: One ThreadSession per thread, ThreadOpening before birth, TurnCommands per holder, no repeated runtime-fact derivations
ord: 1
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cd5c3436715
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatTransport.ts
  - kind: file
    ref: packages/chat-ui/src/ChatTurns.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/chatWire.ts
---
**Outcome.** The facts of an existing thread belong to `ThreadSession`: identity is set at creation and never changes. A column, panel, and later a widget showing one thread in one app window hold one session — one subscription and one fold. A thread before birth is led by `ThreadOpening`. Turn commands are `TurnCommands`, one per holder. The client derives no runtime facts twice. View state is not part of the session: focus, scroll, follow, disclosures, measurements, prompt-history position.

**Port (`wire/`).** `ChatConnection` is a `Context.Service` the kit declares in its own contract. The app composition fills it with the project connection's RPC client ([[e090f46d]]).
- `feed(threadId, from)` answers a feed-event `Stream` with a typed failure in the error channel. Event and failure types are `@runlith/agent` schemas ([[c3436715]]), the kit's platform. The `thread.subscribe` envelope in Tagma carries them without redefining, and the stub hands the decoded RPC through as is. The kit imports no app or Tagma server types.
- `from` is an `Effect` that reads the current `feedPosition`. It is computed on every attach and every resubscription ([[6d2dde6c]]).
- Every turn command and every read (`entriesBefore`, `entry`) is an `Effect` with its own result and its own `Schema.TaggedError` failure. "Load failed" and "no older entries" are different answers ([[ea465bed]]).
- No Promise forms, no `parseFeedEvent`, no `ChatPort.ts:35` casts, and no caller-chosen `T` (`chatWire.ts:17`, `wire/Live.ts:534-541`).
- The connection is project-scoped: identical thread ids from different projects never meet (`wire/Live.ts:246-251`). One snapshot form per channel — [[6412bd95]].

**Storage (`transcript/`).**
- Runtime model events [[c3436715]] — snapshot, state, entry delta — become `ChatEntry` through one `fromEntry` projection, wherever the entry came from.
- Storage holds entries with an id → position index and reports changes: a patch of one entry's content or a structural splice ([[8d75d711]]).
- A growing-text delta carries the appended increment; storage appends it to the entry body without regrouping.

**`ThreadSession` (`session/`).**

Owns:
- feed attach and local connection state: loading, ready, failed — with an opening timer. A thread opened by direct URL whose first snapshot is delayed, refused, or unreadable reaches a visible typed error instead of waiting forever (now `ChatTurns.svelte.ts:111-137`);
- storage;
- `RunStatus` and run identity;
- clock offset to the server;
- `FeedVerdicts`.

It shows pending inputs and optimistic turns from `PendingTurns` (below) but does not own them.

**Session life — `Scope`.** One power over lifetime sits outside the kit with the holder; in Tagma it is the existing thread tier ([[e5e1e307]]). The session itself keeps no refcount.

- `ThreadSession.make(threadId, detached?)` is an `Effect` requiring `Scope` and `ChatConnection`. Closing the scope is `dispose`: the subscription, the opening timer, and all session work are fibers of this scope, and by construction none remains after closing.
- `attach` is an `Effect` in a child scope: a fiber reading `feed` (`Stream.runForEach`). It starts from the resume cursor when the session is restored from detached state, otherwise from a snapshot.
- Closing the attach scope interrupts the fiber. A frame that already arrived at an abandoned subscription is not applied: only the live fiber applies.
- `detach` closes the attach scope and answers `DetachedSession`: storage and resume cursor.
- The opening timer is `Effect.timeoutOrElse` on the first usable attach response: a snapshot or a confirmed resume without a snapshot (`snapshot.ts:92-96`, `ChatTransport.ts:410-417`). There is no separate `setTimeout`.
- A command or load answer after the scope closed changes nothing: its fiber was interrupted with it.
- State read by the surface is `$state` fields of the owner. Only its fiber writes them.
- `DetachedSessions` is a kit mechanism: LRU of detached states per thread, one per project connection. It counts no holders, only stores data. The budget is two ceilings: no more than 8 sessions and no more than 32 MB of estimated storage weight together. A session's weight is the byte estimate of its entries, which storage maintains on every change. It grows with loaded older pages and the live tail (`ChatTransport.ts:306-314`): the per-page wire limit (`cap.ts:4-7`) does not bound the session.
  - A session heavier than a quarter of the weight ceiling is not retained at all: its return is a snapshot.
  - Past either ceiling, the least recently released is evicted.
  - 8 is switching between the threads of one job.
  - 32 MB is the share one tab can hold for returns on a 4 GB machine without evicting the feed's own pages ([[fe83acfa]]).
  - An evicted session returns by snapshot — the same price every return pays now.
- The resume cursor is the producer's `feedPosition`: snapshot and every delta carry it, and it covers durable entries and open-entry deltas. A server refusal in resume — a gap larger than its window (`ThreadWireDeltas.ts:9-19`) or queue overflow (`snapshotFeed.ts:15-27`; a byte-budget overflow also gives a resnapshot, not a lost fact) — arrives as a snapshot and is accepted as an ordinary event.
- A transient socket loss is not a detach: the connection re-raises held subscriptions itself (`wire/Live.ts:396-399,437-449`), and the session continues from the cursor. Destroying the project connection destroys its sessions.
- Holding is not viewing. The "outcome read" mark stays with whoever shows the thread on screen (now `ThreadOnScreen.shown`, `List.svelte.ts:517-541`).

**`ThreadOpening` — the thread before birth.** Owns the new thread's draft, waiting on its first turn, and the local phase (unborn, opening, unreadable — `chatThreadPhase.ts`). Lives in the slot scope. The birth wait (`Effect.timeoutOrElse`) interrupts only the view wait, not the started work: an accepted turn from the first Send lives in `PendingTurns` in the project-connection scope until birth, loading, and send. An expired wait does not prove the turn never went out; receipts decide the outcome.

The surface gets either `ThreadOpening` or `ThreadSession`. There is no fake id and no identity-changing session.

First Send:
1. records the turn synchronously;
2. shows it as an optimistic turn;
3. calls the birth port filled in by the app;
4. on receiving `threadId`, hands the waiting turn to the new thread's session.

**First Send outcomes.**

| Outcome | What happens |
|---|---|
| failure before send (composition, attachment loading) | the thread born by this attempt is deleted through the birth port; the draft returns — as now (`ChatTurns.svelte.ts:425-432`) |
| explicit server refusal | the thread stays; the turn rolls back; the words return to the draft |
| unknown outcome (cut after send) | the thread stays; the turn is marked unconfirmed until the authoritative receipt for its input id arrives (below); the turn's absence from a snapshot decides nothing |

Deleting the thread is allowed only in the first case.

**`FeedVerdicts` — presentation verdicts, derived once.**

| Question | Fact owner | Presentation verdict |
|---|---|---|
| thread not yet born or being born | `ThreadOpening` (local) | hero, birth error |
| whether an existing thread's session connected | `ThreadSession` (local) | loading, opening error |
| run state | runtime `RunStatus` | pulse for working, outcome bar |
| how the run ended | runtime run-end; withdraw deletes the run's entries without run-end, `withdrawn` outcome is in `RunStatus.ending` | cut/failure bar; revoked turn's words return to the draft |
| whether a tool call finished | `ThreadToolState` | live feed rows |
| whether an operation completed or was refused | settled-call outcome `done` or `refused` with a refusal code — from the producer's settlement projector | tool row "refused", not "done" ([[86165526]]) |
| whether a run entry is open | delta and runtime settlement | live feed rows |
| how long the run takes | start from `RunStatus` plus clock offset | clocks |

The surface reads verdicts ([[d1d3672b]]) and derives none itself.

Deleted:
- run-end synthesis (`ChatFold.svelte.ts:17-37`);
- finalization of interrupted parts (`:200-215,510-530`);
- tool-state string predicates (`activity.ts:266-288`);
- `isLiveEntry` by entry shape (`liveStatus.ts:47-59`);
- `entriesFromAgentMessage` (`entryProjection.ts:82-171`);
- `AgentMessageFold` in the client;
- `placeStreamEntries` heuristics (`ChatFold.svelte.ts:397-435`);
- `'x' in data` guards over data parts (`entryProjection.ts:188-250,488-559`).

`ChatTurns.runEnding()` is already a presentation verdict; it moves to `FeedVerdicts`.

**`TurnCommands` — one holder's commands.** Send, queue, answer, stop, compact, continue, unqueue, withdraw.
- Words and local attachments (previews and files not yet uploaded) are recorded synchronously at Send time ([[3be174e5]]). The optimistic turn and the sent turn are one value.
- Every command is an `Effect` with its own typed failure. Resending an unconfirmed turn is a `Schedule` in the `PendingTurns` scope.
- Every turn is a transaction under its client-generated input id. Refusing turn A rolls back only A: an accepted turn B and server events between them stay. The current rollback replacing the whole fold (`ChatFold.svelte.ts:315-319`) goes away.
- A turn remembers the draft key it left from. Rolled-back or revoked words return there exactly once, even if the holder already closed. If the draft already holds new text, the words stand before it across a blank line and nothing is lost. Now they are lost (`ChatTurns.svelte.ts:219-227`).
- `setModelSettings`/`setAuthorityMode` move out of the kit transport to the app owners.

**`PendingTurns` — owner of started transactions.**
- One per project connection; app composition creates it next to the connection.
- Holds every started transaction: input id, thread, draft key, words, state (sending, accepted, unconfirmed). Holds until the authoritative outcome, independent of holders, thread scope, and `DetachedSessions` eviction.
- Closing the view stops publishing into that view, but not outcome accounting or word return. Words go to the draft shelf by key (`DraftShelf`), not into the mounted draft.
- A session holding the thread shows its transactions as optimistic turns.
- A producer receipt by input id resolves the unconfirmed turn. It is carried by a repeated idempotent resend of the same id and by snapshot/`RunStatus` (receipts of still-waiting inputs). An `accepted` receipt (said, queued, steered) confirms the turn, a `rejected` receipt with a code rolls it back. Until the receipt arrives the turn stays visible as unconfirmed. The producer holds receipts: `admit`/`RunReceipt` in [[9f3bb3f9]] — the client's input key, idempotent resend, receipts of waiting inputs in snapshot and `RunStatus`.
- Automatic resend of an unconfirmed turn is finite. A permitted transaction goes out at once. An unconfirmed one past exhausted attempts stays visible as unconfirmed with a "send again" action (same key) and leaves when the receipt arrives or the operator removes it.
- The run-revision guard stays: a fixed identity removes races across threads, but not within a thread.

**How to check (implementer).**

Equivalence test (half the consumer):
- corpus — feed events published by the producer's conformance: a run with tools, interrupt, withdraw, rewind/restore, reconnect with resume, bounded bodies, operation refusal;
- after every settlement point the session storage that received events equals the session storage that received the snapshot the producer independently read at the same position;
- optimistic turns are excluded from comparison.

Life test:
- two holders — one subscription, consistent state;
- `detach` → `attach` from `DetachedSessions` sends resume with the cursor;
- refusal in resume → snapshot;
- LRU-evicted state → snapshot;
- after `dispose` no subscription and no timer (fake connection and fake timers);
- previous-generation frames do not change storage;
- socket loss does not lose storage.

Turn test through public commands:
- refusing one of two turns rolls back only it;
- the unknown outcome resolves by receipt both ways; a snapshot before the command completes and a snapshot whose window excludes the accepted input do not roll it back;
- the last holder closed during a send or revoke in flight: after the outcome the draft gets the right result exactly once, the closed view does not change, evicting the session does not lose the transaction;
- a direct URL of a thread whose snapshot never arrives leads to a visible opening error;
- a pre-send failure deletes the born thread, refusal and cut do not;
- revoked words land in the draft with text without loss.

**Waits.** [[c3436715|Runtime→chat event model]] is needed to delete derivations, deltas, cursor, and operation outcome; [[9f3bb3f9]] for input receipts. The port, `ThreadSession`, `ThreadOpening`, `TurnCommands`, and session life are built on the current feed.
