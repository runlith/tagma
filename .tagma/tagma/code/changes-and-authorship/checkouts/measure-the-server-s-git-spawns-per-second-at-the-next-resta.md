---
id: 01a0d91d-33a8-72f0-aafc-1d3669784604
title: Measure the server's git spawns per second at the next restart on a build carrying eb86960523 and 282a58c329, with the operator's usual tabs open
ord: 27
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/comparison.ts
    symbol: readRow
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
    symbol: GitCheckoutRows
---
The storm of 324bbed1 was measured on the running server's telemetry; the fix was measured only in tests, because the running server was not to be restarted. At the next restart, read two-minute `overview` windows of `Git.result`, `Git.status`, `Git.locations`, `CheckoutStatus.reading` (by `checkout.reason`) and `WebSocket.open` for the first ten minutes. Before the fix: about 39 git spawns a second while one tab reconnected every 3.4 s (about 134 per reconnect), and 5.3–5.9 a second with a freshly loaded tab. Done when the same windows after the fix are recorded here beside those figures.