---
id: 01a123cd-e76f-7052-87bc-8b28115c7173
title: A session that answered within the last 10 s is served without ping, and a dead one is removed by ping after a request refusal
ord: 21
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1236d-51e7-7552-ad52-dbc10c2dbada
sources:
  - kind: symbol
    ref: packages/mcp/src/McpPool.ts
    symbol: McpPool
---
A recent answer lets `McpPool.live` omit an extra `ping` round-trip, which matters for views calling tools many times a second. A stdio transport's close notification removes its session without revoking a complete result already received. An in-flight tool request whose peer closes before sending a result answers `McpCallFailed`; transport closure is not a request timeout and does not replay the tool.

The price of this decision: an HTTP session that died silently inside the window answers the first request with a refusal, not a transparent fix. After such a refusal `answering` pings the session, and if the ping fails too, marks the server `failed` with the ping error and removes the session. The next request raises a new one.
