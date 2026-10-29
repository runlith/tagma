---
id: 01a14e1b-66b8-7f16-b28e-5459af951bf2
title: Bring the missed graphFixture consumers to native Effect
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae9-7a08-9bb0-ae79b53cb89b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f2d-638d-74e9-8a14-33acd1cc7192
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/executions/commandReader.itest.ts
---
Move commandReader and `graphFixture.bench` from remote Promise open/release/run to native Effect; a TypeScript-consumer search also found beat/stalls and two graph benchmarks. Keep the command, heartbeat/stall checks and the benchmarks' measured bounds. Proof — one typecheck of the touched files, a separate commandReader run, and the commit; a manual formatter and extra review are not required by the lead's order.
