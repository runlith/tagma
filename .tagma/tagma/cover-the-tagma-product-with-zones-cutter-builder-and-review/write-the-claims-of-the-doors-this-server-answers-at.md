---
id: 01a0ca97-13e3-7639-9dcc-eea8f2781507
title: Write the claims of the doors this server answers at
ord: 214
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca9b-effb-7288-a42c-4212129b2d53",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/api
  - kind: dir
    ref: apps/tagma/server/src/http
  - kind: dir
    ref: apps/tagma/server/src/socket
---
Read `api/`, `http/` and `socket/` whole — the declaration and its middleware, the handlers, the runtime, the graph pool and its routing, the freshness gate, the succession between servers, the process entry, and the live channels.

Write the claims of [[e2262db0]], [[0f87a1b8]], [[0075ecae]] and [[c1391410]]: what the caller middleware proves and what it does not, which groups stand without it and why, what a schema refusal is shaped like against a gate's refusal, how a request is routed to a graph and what a mirror serves, what succession guarantees to a caller mid-replacement, and what a subscription promises about snapshots and order. The module claims [[05042d40]] state the browser boundary — reference them; do not restate.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].