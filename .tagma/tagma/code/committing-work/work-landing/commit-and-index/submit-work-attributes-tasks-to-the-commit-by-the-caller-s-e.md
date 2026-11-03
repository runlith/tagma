---
id: 01a17db1-1284-7858-8bf5-be5e478a6934
title: submit_work attributes tasks to the commit by the caller's explicit declaration, whoever holds them
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1798b-445d-79ab-ac8b-e05bda418206
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/contract/service/taskLabels.ts
  - kind: file
    ref: apps/tagma/server/src/landing/operations/submit.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/tasksHeld.ts
    symbol: heldTasks
  - kind: symbol
    ref: apps/tagma/server/src/landing/contract/wire/operations.ts
    symbol: LANDING_OPERATIONS
  - kind: file
    ref: apps/tagma/server/src/graph/work/tasks/holding.ts
---
The `tasks` field is the caller's testimony of this landing's link to the tasks' work; holding proves no part in the commit and gates nothing at landing. Any named task, whoever holds it, lands in the commit's `Task:` trailer and the receipt; none is ended, and finish_block names the commit for each one it completes. A stealth task gets no trailer, so a public commit never names a stealth block. The declaration selects no project or checkout. Intersection with sources was rejected: task sources are optional, and a wide catalog does not separate parallel works. Without a declaration there is no attribution, and the separate reminder of the session's held tasks does not propose completing them.

A task's holder is determined by the session's full signature regardless of whether bookkeeping sees its file edits: an external harness may hold a task while its lines count as nobody's. A stopped child's tasks still pass to its parent as the record of who now answers for them. Inside one thread tree (the same spawn root) a native session finishing, closing or attributing a teammate's task meets no `held-elsewhere` question; a task held outside the tree keeps it.
