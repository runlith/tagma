---
id: 01a18f17-c36f-7d6e-b148-746cc155fe6e
title: The server counts each agent act's statements, write units and writer hold, attributed to the act that caused them
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
---
Step 0 of [[2afe6fec]], first half: the server counts what each agent act costs, attributed to the act that caused it, without changing behaviour.

Today's telemetry counts `sql.execute` spans and `Store.permit.wait`, but only inside a kept trace, and the reactive work a call triggers — after-commit tails (`ThreadEvents.told`), `ThreadSnapshots.publish`, thread-list and feed projections, ACP steps — runs outside the call's trace. So per-act cost is known only as an installation-wide average (~497 statements and ~10 write units per hosted call in the 2026-10-30 incident) and no producer is ranked.

What stands when done:
- a root act (hosted tool call, ACP step, operation through a door, background driver) carries a cause that travels into the write units it opens, their after-commit effects, the publications and projections those wake, and the ACP steps they write;
- per root act and per producer: statements, write units (later: programs), writer hold and writer wait, encoded bytes across the SQLite process boundary, spans opened;
- counted at the execution boundary for every statement, sampled or not — never derived from a retained span;
- readable by a bench in-process and by `read_performance` (overview or a ledger query) so producers can be ranked.

Cost of the accounting itself stays negligible: no per-statement allocation beyond a counter increment on the cause's record. No behaviour change: no write, publication or read is added, moved or removed.

Done when an itest drives a hosted `read` through the real door and the ledger answers its statements, units and writer hold split into the call's own work and each reactive producer, and the sum matches the total `sql.execute` count over the same interval.
