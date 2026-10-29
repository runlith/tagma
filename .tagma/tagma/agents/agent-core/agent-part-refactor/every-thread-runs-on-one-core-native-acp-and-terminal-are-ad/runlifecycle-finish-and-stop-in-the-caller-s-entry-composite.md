---
id: 01a11ca5-7ddf-7f42-a891-bd5d91202942
title: "RunLifecycle: finish and stop in the caller's entry, composite take-down of the pushed run and observed open"
ord: 8
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c9a-6edb-7ed8-b517-60ad2121a95f
---
What: the [[2121a95f]] section "What the adapter reports to core" — the terminal `finish` and `stop` acts take the caller's record, like `create` (`creation.tx`); the outbox wakes on that record's after-commit; the composite "stop with withdraw + create" decision in one record, taking down first (`withdrawnTurn`, `lifecycle/closing.ts:135-145`). No consumers yet: the ACP work connects them.

Proof: a `RunLifecycle` test on both storage adapters — an end in a foreign record commits with it and leaves neither end nor outbox row on rollback; the composite act leaves exactly the taken-down run and the new open one, the new turn message after the cut.
