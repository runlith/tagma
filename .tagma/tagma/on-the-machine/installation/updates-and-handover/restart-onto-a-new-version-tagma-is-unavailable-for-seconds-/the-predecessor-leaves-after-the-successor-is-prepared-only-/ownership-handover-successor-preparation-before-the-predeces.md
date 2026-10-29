---
id: 01a126b9-6a5d-780b-8049-42259ae1db7b
title: "Ownership handover: successor preparation before the predecessor leaves, and unloading the gap between doors"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1267b-ea09-7fb8-9262-45fa444a045d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79e89b246531
  - kind: waits-on
    to: 01a126b9-6a5d-780b-8049-421f153b89de
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/boot.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/offer.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/succession.ts
---
Restart states from the spec; digest bundle of the execution host before copying (changing the host itself — [[d86d6647]]); plugin closing without grace waits; a handover message instead of lock polling; run recovery first and rollout reconciliation per thread; the remote door does not wait for history serving; a failed start recorded with its phase. Start with `installation/process/succession.ts`, `composition/server.ts`, `composition/boot.ts`, `executions/host/offer.ts`. First enablement: the successor takes its place also from the operator's build predecessor — preparation up to `STANDING_BY`, lock polling only on that road. The SQLite connection owner removes heavy WAL maintenance from the closing and write path, keeping durability and safe lock release. On the operator's database APFS clone, a measured Close stalls in `ftruncate` inside an implicit checkpoint; a separate COMMIT while draining service accounting took 28.9 s; the auto-checkpoint's part in it is not yet proven. The common cause is investigated and fixed at the connection owner, not with one-off PRAGMAs in the drain. Done when the spec's checks pass, the stand shows a shorter server interval, and the run "operator-build predecessor → HEAD successor" on one's own instance ends with open doors.
