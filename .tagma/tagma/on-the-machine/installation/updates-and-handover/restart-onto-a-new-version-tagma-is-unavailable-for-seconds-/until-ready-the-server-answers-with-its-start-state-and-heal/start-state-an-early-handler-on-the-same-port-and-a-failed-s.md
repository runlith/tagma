---
id: 01a126b9-6a5d-780b-8049-42279bb079bb
title: "Start state: an early handler on the same port and a failed-start record"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127bd-704b-73d3-90e8-b84aa347b184",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ea6417e7fa
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
  - kind: file
    ref: apps/tagma/server/src/http/starting.ts
  - kind: file
    ref: apps/tagma/server/src/installation/process/record.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/open.ts
---
An early handler on the same port and a failed-start record. The start handler on the local door before the stores open, replaced with the full one; the start state at `installation/process`; the open-progress port in `platform/contract/service`; `/health` stays "may work"; a failed start leaves a state in the data catalog. Start with `composition/server.ts`, `http/contract/wire/health.ts`, `platform/store/open.ts`. Delivery `cf66098e3b`: one local listener opens before the stores, the early handler removes itself after the full one is set; `/health` answers 503 until ready. The single `restart.json` keeps the step, phase, and caught cause; the CLI tells an unanswered server from the last successful start. 35 narrow tests passed: the migration pass, handler swap and close, the record and its I/O refusals, remote admission, a real SQLite failure, a busy port, SIGKILL, and CLI status. Owner and startup-test typechecks clean; the widened check of changed roots stopped on someone else's TS2322 in `invocation/registry.ts:17` and `native-harness/kernel.ts:316`. One Sol xhigh round and three Muse xhigh rounds done, confirmed defects fixed. Display in the app and desktop stays the [[220321a5|client task]].
