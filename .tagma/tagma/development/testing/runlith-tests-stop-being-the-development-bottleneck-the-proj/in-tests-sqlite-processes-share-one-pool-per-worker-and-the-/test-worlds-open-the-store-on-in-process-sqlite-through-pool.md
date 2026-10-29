---
id: 01a16e04-e4a2-7707-aae0-722c1e1fdc28
title: Test worlds open the store on in-process SQLite through pool hosting that composition picks
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dec-fbf8-7898-a8a7-e83233ac9f35",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b702168725a4
sources:
  - kind: dir
    ref: packages/sqlite-process
---
`ProcessPool` gains the connection-hosting way from whoever builds it: processes (product) or the same channel protocol inside the process (test worlds). Everything above the channel — `Connections`, `Readers`, handover, retire, writer stall, checkpoint — never changes. Inside a process `busy_timeout` is 0, and BUSY repeats asynchronously to the same deadline: synchronous lock waiting would stop the event loop while a transaction holds it across an `await`. One channel conformance suite runs on both hostings. Door, graph, and terminal worlds open the store in process. The SQL fingerprint in `measured` computes once per query text.

Spike (one loaded sample): collaborationDoor — 33.9 s file CPU on processes vs 20.4 s in process; farEdges — no gain inside noise. The earlier "71.5% on the SQLite path" figure was mostly an attribution error: 59% of samples are fibers continued inside `connection.ts receive`.
