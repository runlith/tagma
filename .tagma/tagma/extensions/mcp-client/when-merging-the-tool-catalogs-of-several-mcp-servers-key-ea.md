---
id: 01a0ca5d-3c5a-7f23-ab1f-6f28e541fe7f
title: When merging the tool catalogs of several MCP servers, key each tool by its `mcpToolIdentity` name, not its bare tool name
ord: 15
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/mcp/src/mcpToolCatalog.ts
    symbol: mcpToolCatalog
---
A catalog from `mcpToolCatalog` is keyed by the server's own tool names, which collide across servers; the identity name carries the `mcp__<server>__` prefix.