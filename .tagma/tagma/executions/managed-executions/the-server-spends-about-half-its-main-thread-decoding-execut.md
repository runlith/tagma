---
id: 01a0d85d-a236-7aba-b3ce-86c6af5cabcb
title: "The server spends about half its main thread decoding execution-host frames, likely rebuilding each command feed every usage pulse: measure it by message kind and fix it at the owner"
ord: 91
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d85e-3423-7803-bb14-f1b9f1d2df09",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/terminals/commandFeedReading.ts
  - kind: file
    ref: packages/executions/src/WireSession.ts
---
**Measured on 2026-09-25 by profile thread 01a0d842** (raw data in its scratch; server profiles `95f3cd77`, `411b042e`, `83428bf1`):
- 47.5% of the server's main-thread samples, with 4–5 agents busy, sit under `NodeSocket.onData` → `packages/executions/src/WireSession.ts` (`decodeHost`/`decodeHostMessage`): Effect Schema 29.5%, `JSON.parse` 7.3%.
- 27 host requests/s and 8 `CommandReader.page`/s.
- The likely driver, not established: `terminals/commandFeedReading.ts#followCommandFeed` recomposes the whole command feed on every usage pulse (1.2 s) while a command it carries moves, once per open command-feed view.
- The decode garbage also drives GC, about 28% of the server's lifetime CPU.

**Telemetry is missing.** `wire.read.dispatch` spans are never retained, and no metric counts frames and bytes by kind (Reply, Inventory, State, Screen, Bytes).

**Do:**
1. Add the per-kind count and bytes measurement at the dispatch, so the cause is read, not guessed.
2. Find which reader asks for what, and how often, per open view.
3. Fix it at the owner: send or recompose only what changed, and decode once what several readers need.

**Done when:**
- the server's main-thread share for host frames and the frames/s by kind are named before and after, with the same agent load noted;
- the new measurement stands;
- the claims over the changed code are revised.