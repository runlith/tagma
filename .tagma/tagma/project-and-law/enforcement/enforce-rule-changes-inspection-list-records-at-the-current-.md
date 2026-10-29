---
id: 01a12ca5-d946-78f9-b8db-0fc899c236cb
title: enforce_rule changes inspection list records at the current revision
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12ca5-9b00-782c-b335-f94f225b8327",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12826-b6c7-7fa3-bbd1-24a78f8859d5
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/enforce.ts
---
Add point put/drop to enforce_rule for builtin inspection lists, where records are edited separately, keeping other parameters and refusing enforcement-stale on a stale base; update the operation description. Proof — a red→green public-operation test, checks of affected code and an independent review; separately check the already implemented base guard and answer the source reflections with commits.
