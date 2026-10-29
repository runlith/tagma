---
id: 01a18849-95b1-7439-a7df-e57a9ec40fd7
title: "MCP kit: bearer contract, typed needs-sign-in status and the OAuth entry"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18838-6781-7364-b78c-ae5bf5b53190",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a184c6-16dd-744f-b710-46e4142a1788
---
Kit part of [[142a1788]] Part 2: the HTTP transport's `auth` (bearer, rejected), a typed `McpNeedsSignIn` carried into `McpServerStatus`, one-server reconnect and a change pulse on the pool, and `@runlith/mcp/auth` over the SDK's discovery, registration, authorization, exchange and refresh.