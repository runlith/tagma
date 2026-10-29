---
id: 01a1281f-3d3c-737d-b94b-5fc495b09f08
title: "ExecutionRuntime.itest exceeds the integration CPU budget: split contract and system scenarios"
ord: 6
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12812-89b3-78cf-8d61-fdf42ec43d63
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionRuntime.stest.ts
---
In the 2026-10-10 run the file `packages/execution-host/src/ExecutionRuntime.itest.ts` took 12107 ms of CPU time against an 8000 ms budget; a separate rerun with the built native library gave 40 pass / 0 fail, 10386 ms CPU and 45.58 s wall time. The file assembles the runtime and runs real processes for dozens of scenarios; system scenarios must be split out or the shared fixture cheapened, keeping the verdict, stop, input-lane and record checks. Done when the integration file passes budget and the extracted system scenarios fit their 60-second limit.
