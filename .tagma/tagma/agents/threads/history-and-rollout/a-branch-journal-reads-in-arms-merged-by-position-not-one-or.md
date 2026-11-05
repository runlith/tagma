---
id: 01a17a3f-5b3f-7aeb-8ff3-d97ea427dd39
title: "A branch journal reads in arms merged by position, not one OR predicate: otherwise SQLite sorts the whole window and misses the identity index"
ord: 12
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15240-8f7a-74d6-8068-23c7ba634604
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/log.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/journal/base.ts
    symbol: byPosition
  - kind: symbol
    ref: apps/tagma/server/src/threads/journal/base.ts
    symbol: eventArmsOf
---
A branch sees several threads' events: its own and source rows through `thread_base` layers. Expressing this as one OR loses SQLite two things. First, it cannot stream rows by `position` up to `LIMIT` and sorts the whole window before the page's first row. Second, in the "is there a later revision of the same identity" check it cannot seek on `thread_event_entry_idx` and walks the thread's tail by primary key for every window row, parsing each row's JSON. Together one page's work grows with the square of the thread length. On a long branch `read_thread` on `entries` held the agent's run for tens of minutes.

So each arm is a separate index select: the source thread, the layer's position range, and displacement by its own row and upper layers at the same position. Arms merge through `UNION ALL` sorted by `position`. The whole-journal condition — no later revision — is written as AND over arms, not one subquery over their union. All arms of one read go in one request: a journal read holds no shared database snapshot. If moving the prefix into the branch's own rows slips between per-arm requests, the record vanishes from both: its own arm has not seen it yet, and the layer arm already displaces it with its own row.

Arms are built at the request's top level and not hidden in a shared `UNION ALL` subquery in `FROM`: SQLite unfolds such a subquery only when the outer query does no join and computes no aggregate. But journal readers join the folded record body from `thread_entry`.

The later-revision subquery names its index with `indexed by thread_event_entry_idx`. With two or more layers, SQLite's own choice for that subquery inside an inherited arm is the primary key's position range, which parses the JSON of every later row of that source for each candidate. The plan follows from the query's shape alone, since the store keeps no planner statistics. On a grandchild branch of about 22,000 positions one 500-row page did not finish in 225 s of CPU; with the index forced, the whole journal reads in about one second.
