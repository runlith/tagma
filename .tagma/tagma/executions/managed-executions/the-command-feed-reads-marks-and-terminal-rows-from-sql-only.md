---
id: 01a136c4-f972-7b48-8274-c64a1f938cf5
title: The command feed reads marks and terminal rows from SQL only when their tables moved, not on every execution-host pulse
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a136b4-0543-7cd5-a38e-72a7e2439d30",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1362d-a0db-7666-88df-6b9d95a079fc
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/commands/feed.ts
---
The command feed (`executions/commands/feed.ts`, `SharedCommandFeed.stepOf`) reads marks from SQL on every execution-host pulse — every `InventoryFeedItem`, including usage-only samples — (`CommandReader.marks`: the whole `command_wait`, owners and the project's newest command) and the project's terminal rows (`Terminals.inventory` → `TerminalRows.inventory`, two statements). The rows almost never change in the meantime.

Measured on the operator's working server on October 13, one 60 s window (one sample): `CommandReader.marks` — 2575 calls (~43/s, 5.5 s summed spans), `Terminals.inventory` — 2575 calls (3.9 s).

Do: read marks and terminal rows only when their tables (`command`, `command_wait`, `terminal`) have moved. What moved is known by whoever writes: the store transaction knows the declared write set of each unit and marks its tables after commit; the read owners (`StoredCommands.marks`, `Terminals.inventory`) hold their last answer until those tables move.

Done when, under the same load (`commandFeed.bench.ts`), SQL reads of marks and terminal rows happen only on writes to these tables, and the feed still sees new commands, wait-mode changes and terminals.
