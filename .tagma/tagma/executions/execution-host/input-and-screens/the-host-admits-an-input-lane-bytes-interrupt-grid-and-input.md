---
id: 01a0c705-c818-77dd-bac1-d93e39f511b4
title: The host admits an input lane — bytes, interrupt, grid and input end — only into the one execution the lane first wrote to, and ends the lane when that execution changes owner; custody acts are the holder's own acts
ord: 1
tags: ["rule"]
sources:
  - kind: file
    ref: packages/execution-host/src/Bindings.ts
  - kind: symbol
    ref: packages/execution-host/src/Execution.ts
    symbol: admitCustody
  - kind: symbol
    ref: packages/execution-host/src/ExecutionCustody.ts
    symbol: accept
---
A lane is any binding; its principal is never compared with the holder's principal: the server decides lane-opening admission. A lane binds on its first act, input end included, in the same check step. A custody act presents the acting principal with no binding and is admitted only from the execution's holder; a transfer ends all its lanes.
