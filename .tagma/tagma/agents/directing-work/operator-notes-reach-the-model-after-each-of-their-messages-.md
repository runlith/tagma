---
id: 01a14bae-6720-7d62-897a-92939e5d3c85
title: Operator notes reach the model after each of their messages — in all threads, in a project's threads, or in one thread
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927c37d1b13b
  - kind: supersedes
    to: 01a14b6d-b26d-7ba4-b425-902fd358b5c8
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/notes.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/notes.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/operations/notes.ts
    symbol: NOTE_OPERATIONS
---
**Value.** The operator says once what to remind agents about instead of repeating it in every message.

**How.** The `read_operator_notes`, `write_operator_note`, and `switch_operator_notes` operations; an agent writes them on the operator's word.

**Behaviour.** A short text reaches the model right after each operator message. A note stands for all of the operator's threads, for a project, or for one thread; a nearer note with the same id replaces a farther one, and a switch turns a note off without deleting it. The answer shows the resulting set and how much it adds to each message.

**Limits.** Built-in product notes are turned off, not deleted. The enabled set is bounded by a shared character budget.
