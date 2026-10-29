---
id: 01a0cb07-cf07-7492-9289-de4e9fee39a8
title: A user-scope MCP declaration change reconciles every open pool before it answers, so the act's latency grows with the projects opened
ord: 5
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0ca97-13f4-7e9f-bc7a-210182167fbe
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/McpServers.ts
  - kind: symbol
    ref: apps/tagma/server/src/mcp/McpServers.ts
    symbol: reconcileAll
---
`reaching` sends a `user`-scope change to `reconcileAll` (`apps/tagma/server/src/mcp/McpServers.ts:355`, `reconcileAll` at :350) and each mutating act awaits it before answering (`yield* reconciling` at :263, :292, :323), so the interactive act's latency scales with the number of pools this server has opened. Done when the act no longer waits on every pool, or the wait is accepted with its cost stated.