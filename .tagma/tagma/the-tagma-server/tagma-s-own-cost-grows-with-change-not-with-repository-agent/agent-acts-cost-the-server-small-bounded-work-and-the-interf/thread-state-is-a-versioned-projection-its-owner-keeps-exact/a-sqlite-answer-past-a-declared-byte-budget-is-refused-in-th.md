---
id: 01a1988d-c61b-7395-9c4b-dabe2ec881e5
title: A SQLite answer past a declared byte budget is refused in the child, once the unpaged graph readers are paged
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a19888-3749-73c6-8c8d-4675e44d6479
sources:
  - kind: file
    ref: packages/sqlite-process/src/host.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/projection.ts
---
The SQLite child should refuse a `Run` answer past a declared byte budget with a typed failure naming the statement fingerprint and size, so that no runaway read can again put gigabytes into the server: one held thread-list read returned 5 GB. The code and its test are written: `reply-guard.patch` in the scratch of thread 01a19878-4d78-70d5-a678-880d7defc965 holds a 256 MiB budget in `host.ts`, `ReplyOversized` in `connection.ts`, and the measured size riding the `Rows` reply so the ledger does not walk the rows again. Its `channel.ts` hunk also carries `SELECTION_KEY`, which has landed since.

It is blocked on readers that legitimately answer a whole graph in one statement. `graph/tree/projection.ts` `projectToTree` reads every block body of a project, and `graph/tree/connections.ts` reads every edge and source. A valid graph larger than any fixed budget would fail tree projection and `rewrite_graph_files`. Page those readers first, re-audit the other unpaged reads, and then land the guard with its reasoning as an explanation.