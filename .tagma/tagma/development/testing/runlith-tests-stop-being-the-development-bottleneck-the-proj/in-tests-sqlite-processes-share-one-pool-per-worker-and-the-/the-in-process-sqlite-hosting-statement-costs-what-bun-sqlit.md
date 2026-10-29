---
id: 01a16e53-25f3-7079-8881-4d989406c155
title: "The in-process SQLite hosting statement costs what bun:sqlite itself costs: cut the channel path's per-item costs"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dec-fbf8-7898-a8a7-e83233ac9f35",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b702168725a4
  - kind: relates
    to: 01a16e04-e4a2-7707-aae0-722c1e1fdc28
---
x-graph measured: `inline.ts drain` — about 38% of `ExecutionRuntime.itest` CPU, the SQLite client — about 30% in `folder.itest`. What is needed: find what process hosting pays per statement over `bun:sqlite` itself (copies, channel-frame encoding, scheduling, service statements) and cut it at the producer, without changing the store contract. Before-and-after measured with repeat `ExecutionRuntime.itest` profiles and one graph file.

Measurement total: nothing to cut in the channel path. In two `ExecutionRuntime.itest` profiles (25.8 and 29.1 s CPU) and one `graph/serving/folder.itest` profile (4.7 s), `drain` time splits as: `answer` — 14–15%, that is `bun:sqlite` itself (`all`/`values`/`prepare`/`close`); `answered` — 17–22%, and nearly all of it is the consumer's `receive`, because the answer synchronously wakes effect fibers, drizzle, and store code inside `drain`. The service `wal_checkpoint(NOOP)` after a write costs about 0.1%, `connection.ts` own code — about 2%. On `folder.itest`, `checkEngine` at every Open showed 4.4% in native `prepare`. A 400-Open micro-measurement gave ≤0.05 ms per Open inside noise: that is the first statement's schema load on a connection, which no check moves into the next statement without verification. The fix reverted, no commit.
