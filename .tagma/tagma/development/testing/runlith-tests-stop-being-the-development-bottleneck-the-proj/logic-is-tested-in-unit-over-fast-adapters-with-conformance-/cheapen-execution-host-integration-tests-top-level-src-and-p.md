---
id: 01a16e2f-c5eb-7c76-b075-48fb161a276d
title: "Cheapen execution-host integration tests: top-level src and posix"
ord: 19
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
`packages/execution-host/src/*.itest.ts` (except `MachineLoad`, `hostExit`) and `src/posix/**/*.itest.ts` per outcomes [[4dbd9a84]]: delete what is covered by owner unit tests, merge host builds, move logic onto host doubles. `composition/testing/**` and shared `posix/testing` helpers stay with x-exec-b. Ledger: `x10/x-graph-host.tsv` in the orchestrator's scratch.
