---
id: 01a118f1-5f59-7eb8-856a-a0e833589ccf
title: threads.presence feed over an explicit thread set
ord: 4
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a118eb-3e7e-7085-8f2e-2cce9f3bb3f9
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/feeds.ts
---
The client watches an explicit set of threads — seats at the table, a tournament observer, tree branches — without subscribing to their transcript. The `threads.presence` feed serves each thread's presence: run state and a short tail of reasoning. The project thread list and presence take these fields from one projector.

**Why.**
- `thread.subscribe` serves the transcript window on open, the thread state without transcript on every state event, and chunks to every subscriber (`threads/contract/wire/feeds.ts:27-35`, `threads/list/feeds.ts:88-94`).
- The project list row already carries `life`, `phase`, `activeRunStartedAt`, `ask`, `saidLine`, `outcome` (`contract/wire/list.ts:55-95`). But the list is a 50-root window of the project, not a chosen set, and it has no reasoning tail.
- The consumer is an explicit id set, part of it outside the window. One feed over the set fits it better than 100 thread subscriptions.

**Feed contract.**
- **Input:** project and id set. The holder does not change the set. A new set is a new subscription: params are a thunk ([[6d2dde6c]]).
- **Set splitting.** Holders with the same set share one subscription (`ThreadPresence` on the client, refcount by set). Different sets are different subscriptions, so one seat joining or leaving does not reread another's set. Overlapping sets with a shared per-thread subscription are not the goal: they have no consumer.
- **Presence row:**
  - `RunStatus` ([[9f3bb3f9]]);
  - active run start;
  - operator question;
  - last said line;
  - last run outcome;
  - model;
  - `archived`;
  - open reasoning entry tail.
- **Initial answer** — one row per id. An id that does not exist or belongs to another project arrives as a `missing` row with a reason, and the feed does not fail. An archived thread stays a row with `archived`: it was chosen explicitly.
- **Consistency.** Every row carries the thread revision. The server subscribes to changes before reading the initial rows, and serves a change only when it is newer than the revision in the initial answer. So no change is lost or applied twice. The client drops frames of a previous subscription generation.
- **Events:**
  - a row change carries the revision and only the changed fields;
  - thread deletion is `missing`.
- **The reasoning tail** is identified by `(runId, entryId)` of the open entry. A tail event is one of three kinds:
  - **start** carries the key and the whole tail; a presence row in the initial answer carries the tail with the key the same way;
  - **append** carries only the appended text and `drop` — how many code points to drop from the tail start to stay within the limit; the client holds the key from the start. The client tail always equals the producer tail;
  - **end** is `null`: there is no open reasoning entry left.
  - The tail restarts instead of appending to the previous thought on a new reasoning entry and on resubscribe. An append longer than the limit arrives as a start. The tail ends when the entry leaves the producer's open tail: landing, run settlement, withdraw. While the entry is open the tail holds its latest thought, even when the reasoning already finished;
  - the tail limit is a code-point count, cut by the producer. The limit is tuned so the observer sees the latest thought. The full reasoning stream is `thread.subscribe` of the open thread.
- **Reconnect** gives a new initial answer over the set. No resume is needed: presence is current state, not a journal.

**Server mechanics.**
- The presence row is a pure projection of `RunStatus` and the open-entry delta, one function. The `life`, `phase`, `activeRunStartedAt`, `ask`, `saidLine`, `outcome` list fields are computed by the same function ([[51c66cb6]]).
- Presence holds no permanent process. A subscription finds its threads' current `RunStatus` on open and leaves the index on close.
- A terminal thread gives its transport's `RunStatus` of the same shape.
- Deltas reach subscribers through a "thread → presence subscriptions" index. A token delta on a thread costs work proportional to the number of subscriptions on that thread. A thread with no presence subscribers does no presence work. No full snapshot is built for presence.
- The feed is declared as `PRESENCE_FEED` in `THREAD_FEEDS`: `feed(...)` with schema and refusals, `callers: 'operator'`. The implementation is an `Effect` `Stream` over index subscriptions in the subscription scope.

**How to check.**
- **Implementer:**
  - feed tests — initial answer with `missing` and `archived`; a change during the initial read is neither lost nor duplicated; only changed fields; tail reset on a new entry, settlement, and withdraw; a stream through the tail limit repeatedly gives exactly the producer tail, including non-BMP characters and reconnect on the cut boundary; deletion; new set; reconnect;
  - server test: a token delta of a thread with no presence subscribers does no presence work.
