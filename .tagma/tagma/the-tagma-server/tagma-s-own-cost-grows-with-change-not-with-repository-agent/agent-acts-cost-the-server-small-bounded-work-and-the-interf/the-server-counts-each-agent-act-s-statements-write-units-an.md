---
id: 01a18f17-c36f-7d6e-b148-746cc155fe6e
title: The server counts each agent act's statements, write units and writer hold, attributed to the act that caused them
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18f18-0d87-7ab2-a275-054ae8b576bf",
    "status": "in_work"
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
- per root act and per producer: statements, write units (later: programs), writer hold and writer wait, logical SQLite payload bytes across the process boundary, spans opened;
- counted at the execution boundary for every statement, sampled or not — never derived from a retained span;
- readable by a bench in-process and by `read_performance` (overview or a ledger query) so producers can be ranked.

Cost of the accounting itself stays negligible: no per-statement allocation beyond a counter increment on the cause's record. No behaviour change: no write, publication or read is added, moved or removed.

Verified by `composition/testing/threads/hostedCosts.itest.ts` on seeds 1, 2 and 3: one hosted `read` accounts for 255 statements, exactly the interval's 255 `sql.execute` completions. The split is 170 own, 50 snapshot publication, 16 list projection, 5 HEAD coverage, 5 enforcement coverage and 9 deferred activity statements; warm event/feed projections read no SQL. The sample opens four Store units and 583 spans. One seed held the writer for 9.47 ms: 8.33 ms own and 1.14 ms activity. Byte counters measure logical SQLite payloads, excluding IPC framing. Accounting overhead under sustained load and the broader workload remain unmeasured.
