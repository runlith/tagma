---
id: 01a130f6-a45e-7a7c-915a-82ae6529854c
title: Keep terminal input order up to asynchronous RPC admission
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a130cf-f79d-7fcf-9df7-a34d31836cd5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a130d0-e17e-7768-97f0-86673141aede
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/socketBinding.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/channel.ts
---
Fix a reproduced race: one input lane's requests must keep order from the moment the server accepts them, including preliminary RPC admission. Start from composition/socketBinding.ts and executions/terminals/channel.ts; keep different lanes independent, failure and cancellation handling, plus receipts with no byte redelivery. Prove the fix through a real server binding with delayed first-request admission and admitted-input verification; run the affected owners' checks and an independent review, land the change.

The fix landed in be9f64a603 and 081ca800a4: the queue covers RPC admission, and the shared TerminalLanes keeps receipt order and delivery across two socket doors. Checks: 15 tests passed, including a real WebSocket; typecheck passed; the independent review is done, confirmed remarks fixed. The operator's working server wasn't restarted, the fix's application to it unverified.
