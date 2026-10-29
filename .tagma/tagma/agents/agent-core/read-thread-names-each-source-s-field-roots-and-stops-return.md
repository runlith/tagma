---
id: 01a15175-d7ed-72da-96f2-825590eedd86
title: read_thread names each source's field roots and stops returning the run journal in every response
ord: 76
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1516d-45bf-751e-8cd2-c5f0271022e2",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/evidence/reading.ts
  - kind: file
    ref: packages/agent/src/protocol/threadQuery.ts
---
Thread 01a1516b-edde-7517-8140-a879082e41bc (Opus) twice received `unknown-field` from `read_thread`: `order.by: at` for `runs` and `where runId` for `records`. The tool description required writing the field from the root declared by the source, but named no roots — the model guessed from neighboring sources. The root list is now generated into the description from `THREAD_QUERY_FIELDS`, moved into `protocol/threadQuery` — the same constant the server checks the query against.

Found alongside: a response with `select` put each thread's full pinned run journal into `threads[]` (`queryTargets(pin)`), though the response schema declares `{threadId, head}`; `runs` with `limit: 4` yielded 99 KB. The producer now projects onto `EvidenceThread`.

Proof: typecheck, `operationsDoor.itest.ts` checks the response `threads` as `[{threadId, head}]`.
