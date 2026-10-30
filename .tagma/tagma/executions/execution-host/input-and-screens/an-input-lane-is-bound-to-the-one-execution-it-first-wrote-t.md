---
id: 01a0c705-c818-77dd-bac1-d93e39f511b4
title: An input lane is bound to the one execution it first wrote to and ends when that execution changes custodian
ord: 1
tags: ["explanation"]
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
A lane is any binding, and its principal is never compared with the holder's principal: the server decides who may open a lane. A lane binds on its first act, input end included, in the same check step. A custody act presents the acting principal with no binding and is admitted only from the execution's holder; a transfer ends all of the execution's lanes, so a former holder's lane cannot keep writing.