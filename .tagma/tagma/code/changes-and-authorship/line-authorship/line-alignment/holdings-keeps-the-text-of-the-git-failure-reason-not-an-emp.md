---
id: 01a13f66-f26b-7f42-a20e-b63297b0bee9
title: Holdings keeps the text of the Git failure reason, not an empty Error.message
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13f3a-f78e-7608-8113-58e0ec2af22f
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
    symbol: causeOf
---
Holdings keeps the text of the Git failure reason, not an empty Error.message.

On an injected check-ignore failure `GitEndingUnreadable({command, reason: 'ignore policy is unavailable'})` the judge correctly goes stale but writes `cause: ''`: `holdings/inputs.ts#causeOf` takes the empty `.message` from the tagged error while the stated text lives in `.reason`. Measured in the ignoredInputs.itest.ts contract during [[ec2af22f|the CPU-load work]]; this is no regression of the early cut. Check the Git failure shapes and pass their stated reason through the Holdings owner; the public stale read must carry the original text while the holding list is preserved.
