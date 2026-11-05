---
id: 01a16449-f3a3-7a52-9c4a-904fe82af907
title: "Thread events from one owner and an agent subscription to any threads: rested, failed, stalled, awaiting the operator, addressing a human"
ord: 2
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/childUpdates.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/pluginEndings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/attention.ts
---
An agent learns nothing about a thread it did not start: the report goes only to whoever assigned the work, and the "child finished, compacted, cooled" rows go only to the parent (`parentOf` in `threads/collaboration/childUpdates.ts`). A subscription gives an agent any thread's events; but first the thread events need one owner.

## Three derivations of the same thing today

Each subscribes to run ends and decides on its own what happened to the thread:

- "Attention" (`attentionOf`, `threads/list/attention.ts`) — awaiting, failed, finished; phone push reads its changes (`push/courier.ts`);
- parent rows about children (`threads/collaboration/childUpdates.ts`) — `ran`, `compacted`, `cooled` with a wake price;
- turn ends to the plugin that started the thread (`threads/harness/pluginEndings.ts`).

A subscription as a fourth such derivation would yield a fourth "finished" and diverge from "Attention" — the rule "one fact is derived by one owner" forbids it.

## Thread-event owner

One owner in the `threads` module derives a thread's events once, from entries the server already keeps:

- **`rested` — rested.** The turn ended, the thread queue holds nothing, no thread of its spawn tree runs, no background work of the thread runs. It will never wake on its own again — only when woken from outside. This tells a finished job apart from a finished turn: a lead whose turn ended while its children still run has not rested. The event carries the turn's whole last answer and an address.
- **`failed`** — a run failed or was cut: the cause kind, provider, repeatability.
- **`stalled`** — the thread or a running thread of its tree shows no durable movement longer than its transport allows — the same measure as the thread row's "stalled"; it names who stands. Without it, a lead waiting for a stuck child never rests.
- **`awaiting`** — a question is open whose approver is the operator. After [[e46b150a]] this is a root's question with no parent, or a thread's question the operator intercepted: a performer's question is finally answered by its parent.
- **`addresses-human`** — a root's turn ended, the root did not rest, and the decision ([[8105540f]]) on the turn's final text answers "this text asks a human or awaits their decision". Only a human reads a root's final text: a lead speaks to children with tools. Asked only about subscribed roots. A decision refusal yields no event and stays in activity.
- **`stopped`** — the operator stopped a run; nobody reports such a stop today.
- **`model-changed` — model change.** A thread's model (with provider) or reasoning step changed, by whoever changed it — the operator in the interface or an agent; the event names the old and the new. A parent reads a short row on its next step; a sleeping one never wakes on it. An unread choice change is replaced by the next choice change, but not by a turn end, compaction, or cooling: these facts never cancel each other.
- **`committed`, `task-closed`** — a thread session's commit, a graph task closed by its session.

The first step is a behavior-preserving carry: "Attention" with push, parent rows, and plugin turn ends read the owner instead of deriving their own; their texts, delivery, and tests stay the same. A separate commit.

## Agent subscription

- An agent subscribes as a list to any threads it may address, unsubscribes as a list, and reads its subscriptions. `spawn_agent` can also subscribe: the root starts working at once, and a separate subscription call would miss its first events.
- Subscription is to threads, not trees or projects: its root watches its own subtree, and a lead handles its performers' failures.
- A subscription is durable: it survives a server restart and ends on its own on archive or deletion of the thread or the subscriber.
- **Delivery follows the current parent-row path.** A working subscriber reads the event on its next step. An idle one is woken by `rested`, `failed`, `stalled`, `awaiting`, and `addresses-human`; the rest queue. Unread states of one thread merge into the last-state row; an independent model-change fact is kept separately and replaced only by the next choice change. A subscription may narrow which events wake.
- The row is short: thread, event, text or cause, address. The subscriber reads details itself.
- A parent is implicitly subscribed to its children: `ran`, `compacted`, `cooled` rows travel the same delivery path — one mechanism, not a second.
- Doors: native-agent tools and operations for CLI threads through MCP Tagma; asked only in review.

Subscription of a plugin to foreign threads and a team board in the interface are future consumers of the same owner, not here.

## Performer checks

- Owner through the public entry: a lead with two children — its turn ends while children run yield no `rested`; the end after the last report yields exactly one `rested`; a child's failure yields the lead subscriber no event; a lead's question awaiting the operator yields `awaiting`; a stuck child yields `stalled` with its name.
- Subscription: list subscribe and unsubscribe; only its own kind of event wakes an idle subscriber; several unread states of one thread form one row that never recalls an unread model change; archiving the target ends the subscription; a subscription in `spawn_agent` gets the root's first event.
- `addresses-human` on the decisions double: "yes" yields an event, "no" yields nothing, a refusal yields nothing and an activity entry.
- The "Attention", push, parent-row, and plugin-turn-end tests pass unchanged after the carry.
