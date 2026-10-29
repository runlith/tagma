---
id: 01a1649b-b78d-755e-b97c-6bc9d9ed050e
title: Agent subscribes to any threads and learns when they rest, fail, stall, wait for the operator, reach out to a human, commit, or close a task
ord: 11
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a16449-f3a3-7a52-9c4a-904fe82af907
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/events/happened.ts
  - kind: file
    ref: apps/tagma/server/src/threads/subscriptions/recipient.ts
---
**Value.** An agent learns what happened to a thread it did not launch: the operator's secretary or a lead watches other teams without owning them and without polling them.

**How.** The `subscribe_threads`, `unsubscribe_threads`, and `read_subscriptions` operations — deferred native-agent tools and operations for CLI threads; `spawn_agent` with `subscribe` subscribes to the child being born before its first turn. A thread is addressed the same way as in `send_message`.

**Behaviour.**
- Events: rested (`rested`), failed, stuck (the thread itself or a running thread of its tree, naming who stands), waiting for the operator, reaching out to a human (a root that did not park but whose decision on its last words says "asks a human"), stopped by the operator, committed, closed a graph task.
- The `subscribe_threads` and `read_subscriptions` answers say where each thread stands now: title, running, waiting on a question, stuck or rested, the reason for its last failure, when it last made progress, and its last spoken line. A thread that already rested gives no event until it moves — the subscriber learns that from the answer.
- A subscriber gets a row: thread, event, reason, address; "rested" and "reaching out to a human" carry the whole last turn answer. A row longer than the output envelope arrives as its start plus the full text's address, like a long tool answer. A working reader reads it at its next step; an idler is woken only by rested, failed, stuck, waiting for the operator, and reaching out to a human — and only by the ones the subscription kept in `wakes`.
- A turn opened by the operator's word is its own conversation: "rested" after such a turn arrives quietly, marked "your words", and no "reaching out to a human" is derived for it.
- An unread row about a thread is replaced by the next row about it — for a working subscriber and for an idler alike: a row with no wake waits for its next turn in the queue.
- A subscription outlives a restart and ends on its own when the thread or the subscriber is archived or deleted.
- Rows to a parent about children (finished, compacted, cooled) ride the same delivery.

**Limits.**
- Subscribing is to threads, not to trees and projects.
- Apps and the interface do not subscribe to events.
