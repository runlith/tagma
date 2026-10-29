---
id: 01a13d07-464b-7c9d-9fcd-ab84187930f0
title: "Check-then-create races in HEAD tracking: heads.of and driver.follow"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c96-629e-7f35-b300-604988b2705d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c96-169c-7e49-ba96-9b696b8f8ca5
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/heads.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/retire/driver.ts
---
In `heads.of` and `driver.follow`, a `yield* Scope.fork` stands between checking the map and writing into it. The run loop may yield the fiber before any operation once `MaxOpsBeforeYield` is exhausted. Two simultaneous first calls for one checkout then each install a HEAD tracking. One entry overwrites the other, and the orphaned `headMoved` stream lives until the owner scope closes. In `driver.follow` such a stream keeps ordering passes after vacate.

Fix: take or create the entry atomically under the owner's `Semaphore(1)`.

Proof is tests with two parallel calls at `MaxOpsBeforeYield = 3`: `record/heads.test.ts` and `composition/testing/change-record/retirementFollow.itest.ts`. Before the fix both fail: "Received: 2".

`stream.open` has no race. `sides` belongs to one subscription, and `open` is called sequentially: at assembly and from the single `next` loop.
