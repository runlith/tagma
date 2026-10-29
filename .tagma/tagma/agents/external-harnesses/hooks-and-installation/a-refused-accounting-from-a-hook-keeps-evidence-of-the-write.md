---
id: 01a127e5-d14f-7e6d-a44b-8d8f516487d5
title: A refused accounting from a hook keeps evidence of the write that already happened
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a127b4-0662-7e33-94b6-62cf120ee1fa
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
    symbol: refusedWrite
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/hooks/pendingWrites.ts
    symbol: keepRefusedOp
---
A hook learns the accounting outcome only after the file has changed: a refusal does not undo the write and gives no ground to treat it as accounted. The evidence of the refused change is kept apart from repeatable messages, because the next tool may change the same path while its `before` already belongs to another write.
