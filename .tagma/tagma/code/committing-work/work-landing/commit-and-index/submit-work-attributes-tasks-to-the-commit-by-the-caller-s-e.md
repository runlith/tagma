---
id: 01a17db1-1284-7858-8bf5-be5e478a6934
title: submit_work attributes tasks to the commit by the caller's explicit declaration
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
---
The `tasks` field is the caller's testimony of this landing's link to the tasks' work; holding only checks that a task belongs to it or to a holder from `taking`. One filtered set feeds the commit's Task trailers and the receipt. The declaration selects no project or checkout. A task's holder is determined by the session's full signature regardless of whether bookkeeping sees its file edits: an external harness may hold a task while its lines count as nobody's. Holding itself, including handover from a stopped child, proves no part in the commit. Intersection with sources rejected: task sources are optional, and a wide catalog does not separate parallel works. Holding time also admits others' edits; so without a task declaration there is no attribution, and a separate reminder of held tasks does not propose completing them.
