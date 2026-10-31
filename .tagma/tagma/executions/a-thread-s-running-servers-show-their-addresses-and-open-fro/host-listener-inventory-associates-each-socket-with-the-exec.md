---
id: 01a19420-c5b9-7620-8957-44a8af106d33
title: Host listener inventory associates each socket with the execution holding it
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-2401-77d8-a37d-66b57d3d07b8",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a19420-92b3-74b1-b0e9-37b06636131b
sources:
  - kind: file
    ref: packages/execution-host/src/ProcessEvidence.ts
---
`ProcessEvidence.inventory` (packages/execution-host) answers namespace sockets without `association`, so `terminals/inventory.ts`, `terminals/reads.ts` and `servedRoots.ts` give every terminal `listeners: []`. Associate by kernel tables with the per-execution reading's relations, over one process-table scan per reading; invert `evidenceDispatch.itest.ts:72`.