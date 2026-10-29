---
id: 01a127af-c14d-7f11-84ef-57cf97f1d698
title: The holder port and wire express acts on the execution without POSIX mechanisms
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4ec70308b97d
  - kind: implements
    to: 01a127ad-cc0d-7a03-b77a-95f17df613b0
  - kind: waits-on
    to: 01a1271e-2479-7971-9b0c-4ec6e946bdd8
---
In the line's host worktree, carry the neutral stop acts, work identity, and terminal operations into the Holder port and shared wire per the terminal-quality spec [[7df613b0]]. Start with `src/holder/Holder.ts`, `src/nativeLaunch.ts`, `src/ExecutionStop.ts`, and `packages/executions/src/protocol/call.ts`; one implementer changes the declarations and all consumers. Numeric signals, pgid, fd, and act translations belong to the adapter; the core and the server read the owner's answer. The arbitrary named-signal capability on POSIX keeps its old refusals. Done when acts through the public port and host give the same result on macOS, the wire keeps the stop cause, and the shared layer imports no platform adapter. Current contract checks move with the implementation; no terminal regression is accepted for the sake of the update arrangement.
