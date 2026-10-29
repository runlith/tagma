---
id: 01a0c717-a194-7671-85f0-da6171866771
title: Decide a release and a take from the authenticated scope, never from the ids the act's payload names
ord: 81
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c705-c818-77dd-bac1-d93e39f511b4
sources:
  - kind: file
    ref: packages/executions/src/protocol/custody.ts
  - kind: symbol
    ref: packages/execution-host/src/ExecutionCustody.ts
    symbol: ExecutionCustody
---
In `ExecutionCustody.decide` (`packages/execution-host/src/ExecutionCustody.ts`) the `Release` arm compares `act.binding` and `act.principal` — fields of the request payload — against the standing controller, not the `binding` the scope authenticated as; and the `Take` arm installs `act.principal`/`act.binding` as the controller. Any scope holding a valid binding can therefore end the operator's control by naming the controller's ids in the act, which is the outcome the arm's own comment says it exists to prevent ("would let an observer fence the operator").

Fix at the owner: a release compares the authenticated `binding` (id and principal) with the standing controller; a take installs the authenticated binding as controller, or — if handing control to another scope is a product act — checks that the named binding exists under the holder's epoch before installing it. Then drop the payload fields that no longer decide anything, in the protocol (`packages/executions/src/protocol/custody.ts`) and its consumers. Done when a test presenting a release from a non-controller scope that names the controller's ids is refused `NotController`.