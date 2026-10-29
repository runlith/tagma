---
id: 01a17824-2cb4-7935-aeb4-adf9545fc81f
title: The holders_proven step does not touch an owner number the copy cannot prove
ord: 108
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1780a-fc0d-7db1-9eb8-6959abefee59",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/steps/holdersProven.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/sessions.ts
---
A copy holds an unprovable number as the `elsewhere:<number>` session and writes it into the file with the same number, so branches of one graph translate only their own numbers and merge with no conflict on the owner row. The fix is in `graph/tree/sessions.ts`, `graph/tree/export.ts`, `graph/steps/holdersProven.ts`, `graph/contract/service/steps.ts`; the test is `graph/serving/advance.itest.ts`. The task ends with the commit carrying it.
