---
id: 01a11901-470f-7498-99ae-69e618d547b2
title: "Kit: Effect port ChatConnection, ThreadSession in Scope, ThreadOpening, TurnCommands, PendingTurns, DetachedSessions — on the current feed"
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e0eb9c2129
sources:
  - kind: dir
    ref: packages/chat-ui/src/session
---
Build the parts of [[eb9c2129]] that do not wait for the event model: the `ChatConnection` port (`Context.Service`, feed `Stream`, Effect commands with TaggedError), storage with an id→position index, `ThreadSession` (Scope, generational attach, loading/ready/failed, deadline on the first usable response), `DetachedSessions` (8 and 32 MB), `ThreadOpening`, `TurnCommands`, `PendingTurns` (transactions by input id; before producer receipts an unknown outcome stays unconfirmed). Delete `ChatTurns.svelte.ts` and the static `WeakMap` `ChatTransport`; move the consumers in the app (`View.svelte.ts`, `ChatPort.ts`, `Conversation.svelte`) in the same change — minimally, without taking apart `HarnessHost` (that is [[e5e1e307]]). Chunk projection, heuristics, and run-end synthesis stay until the task that removes derived facts.

Done: typecheck; moved ChatTurns/ChatTransport/ChatFold tests green; life and turn tests from [[eb9c2129]] (except receipts); no `ChatTurns.svelte.ts` debt.
