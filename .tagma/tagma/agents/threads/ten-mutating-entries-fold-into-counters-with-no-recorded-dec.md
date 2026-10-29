---
id: 01a0cab8-8a9b-729d-8e73-da2726b1fe88
title: Ten mutating entries fold into counters with no recorded decision, `delete_thread` among them
ord: 86
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/operations/catalog.ts
  - kind: file
    ref: packages/agent/src/tool/words.ts
---
The `presentation.many` fold was declared absent on durable-changers (`shape.ts`: those never fold, because a change hidden inside a counter is a change nobody reviewed) — but that comment was stripped in c6f42a3059 with no decision recorded anywhere, and ten mutating entries now carry one: move, archive, delete (`destructive`, with a consequence line), sweep, pin, delegation, name, adopt and repair in `session.ts`, and `capture_memory_reading` in `process.ts`. `Deleted ${count} threads` is the sharp end. No claim states which durable changes may fold and why.

Done when the entries and a recorded decision agree — either the fold is removed from the mutating entries, or a claim states which durable changes may fold and why — with `delete_thread` decided explicitly.