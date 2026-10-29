---
id: 01a13699-a210-7d07-bc71-da6f2276ac62
title: A trial instance finishes the execution host and the holder when the server leaves
ord: 27
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13699-0777-7a36-9e70-40bd1d576931",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13697-c0ea-7633-905f-c2cca1b6e4eb
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/boot.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/launch.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/lifetime.ts
---
Fix the execution host and holder orphaning on `tagma:try --stop` and server death: the instance owns process life; losing the server finishes them and the held work with no outside reaper. Start from holder launch and ownership transfer at Succession; prove stop and emergency departure with a system test, keep executions across an orderly handover to the successor, pass typecheck and an independent review.
