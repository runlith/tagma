---
id: 01a13f8f-b4fd-7808-aac9-5070e51da4f1
title: Determine the cause of the MCP HTTP-stand assembly timeout
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523d-71cd-acb6-4296368176de",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f2d-638d-74e9-8a14-33acd1cc7192
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/mcpDoor.itest.ts
---
A lone `bun test --parallel=1 ./apps/tagma/server/src/composition/testing/http/mcpDoor.itest.ts` never reached the test body: the suite-layer assembly hook stopped after 10123.60 ms, the whole file took 19.29 s, the guard destroyed 6 dangling processes (execution `36cc077b-bba2-4d64-acba-cc34c0f4f95`, incarnation 166). No `add_project` response before the stop; the delay's cause and the assembly phase undetermined, load influence unproven. Diagnostics placed the cost at the producer: one new-project registration took 7264 ms, of it `GraphPool.open` — 5921 ms; the subtree holds 706/706 spans and 378 SQL spans (1218 ms wall, 84 ms SQLite execution). Runtime assembled in 19940 ms. This is one sample with a lossless full trace, execution `1b449056-2485-4c73-a37d-e4ff03fc7df9:166`; the old timeout was not reproduced separately. `ensureGlobal` is absent from the registration subtree; its boot cost is unmeasured. The root fix for graph opening moved to [[ec522548|the graph-serving owner's task]] and out of the test port. Controlled cancellation of the unfinished assembly and regular closing of the full door world verified separately: 2/0, the stand's SQLite children freed.
