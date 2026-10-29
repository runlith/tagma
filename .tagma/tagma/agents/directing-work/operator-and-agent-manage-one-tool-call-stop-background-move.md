---
id: 01a14bae-6720-7d62-897a-9294da5d3d19
title: Operator and agent manage one tool call — stop, background, move the deadline — without touching the run
ord: 7
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: supersedes
    to: 01a14b6d-b272-7b0a-96ae-43eb549b6a54
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/CallControls.svelte
  - kind: file
    ref: apps/tagma/server/src/native-harness/operations/calls.ts
  - kind: file
    ref: packages/agent/src/agent/callProgress.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/contract/wire/operations/calls.ts
    symbol: CALL_OPERATIONS
---
**Value.** One stuck or long tool call is decided separately, without stopping the whole turn.

**How.** Call controls in the feed; the `read_calls` and `control_call` operations.

**Behaviour.** A call can be stopped — the model gets it as its outcome and decides next; released to the background at any stage — while preparing, waiting its turn, waiting for permission (even when the whole turn stands on its question), or already running: the turn frees at once, the call is finished in the background, and its result reaches the thread as a notification and wakes it, after a restart too; later calls from the thread touching the same resources wait behind it instead of overtaking it; given a new deadline. A call that itself asked for the background answers with a receipt at once, before preparation. In a native turn the final structural outcome replaces the receipt in the tool's original record before the thread is notified, even when the turn already ended.

**Limits.** The operator reaches any call of the project, a thread — only its own. Before execution, only a call that has someone to take its outcome goes to the background — a call with no thread has no button. A missing permission is not bypassed that way: the question stays open and moves to the thread. A restart leaves background calls with no result as cut: a started one — with unknown outcome, an unstarted one — as unrun.
