---
id: 01a116e1-91a1-7183-b584-52bb072fb619
title: Execution-host replacement keeps each execution's stop failure in its own result
ord: 5
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a116c6-1f18-74ee-a89f-967c69003cc1
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/host/replacement.ts
    symbol: ending
---
`host/replacement.ts` `ending` (line 263) turns a Failure from `executions.stop` into `undefined`, then filters those entries out of receipts. An answered result loses the distinction between an execution that needed no stopping and a stop attempt whose outcome is unconfirmed. Trace the `ReplacedExecution` contract, the subsequent `settling` and the replacement answer; keep each execution's failure/uncertainty without declaring it stopped and without forbidding safe further host checks. The change touches the replacement result's wire and its consumers, so it stands apart. Done when an owner-level test of mixed stop outcomes keeps the successful receipt and the unconfirmed outcome's cause; the code is landed.
