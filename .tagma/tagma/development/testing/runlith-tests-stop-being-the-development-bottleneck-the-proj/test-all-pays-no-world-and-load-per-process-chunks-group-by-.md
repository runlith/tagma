---
id: 01a16e4c-ef00-72c2-8af0-72106b505131
title: "test:all pays no world and load per process: chunks group by world kind and grow by measured time"
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
---
First `test:all` read (x-runner, 162 chunks, 2226 files, 408 worker processes): loading 378 s, of it 204 s — every worker's first file (about 0.5 s per process). World 430 s; `DoorFixture` built 27 times (133 s, about 4.9 s per build) in 10 chunks — about one build per worker that received a door-world file. Proposal: server-integration files laid into chunks by world kind — from the last report's `world` rows, unknown files into a mixed chunk — and a chunk sized with files' measured time against the 5-minute `bun test` life. Expectation — about 100 s CPU on `DoorFixture` and about 30 s more on terminal, landing, and enforcement worlds. Who fixes what is decided with x-runner, the `test:all` owner.
