---
id: 01a19471-c11f-7184-8092-d9c0a990be94
title: Folded thread histories held in server memory stay within a resident budget
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19472-8e6b-7d29-8c7d-8b57bd55cb0a",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/history.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/heldHistories.ts
---
Section F of [[2afe6fec]].

Measured on the live server (instance `1e33b7f0`, about 20 agents, 2026-11-01), heap snapshots `600ef19b` and `8039e995` 18 minutes apart:
- objects shaped `{stored, history, guidance}` — the `Held` of `native-harness/transcript/history.ts`, kept per unit in `foldsByUnit` and as `standing` in `HeldHistories` — grew from 43 to 85, 11 → 39 MB dominated;
- `HeldHistories` entries grew from 35 to 43, 27 → 32 MB;
- `HistoryIndex` grew from 0.6 to 9.4 MB.

Bun's snapshot records no edge from Map or WeakMap storage to its entries, so which holder keeps the 85 `Held` objects is not separated.

`HeldHistories` bounds 128 MiB of `JSON.stringify(message).length * 2`: an estimate of serialized size, not resident memory, and the weighing serializes each new message once more. Its `publish` also builds a Set of the whole history on each call.

What stands when done:
- every in-memory history holder declares a resident bound and evicts past it;
- a unit's folds leave memory with the unit;
- weight is known without serializing the message again.

Done when a census after full collection stays flat over a steady run whose threads together exceed the bound, and the history owner's contracts stay green.
