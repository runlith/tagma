---
id: 01a18edb-7eba-7e20-a7d7-e96c61fb816c
title: An MCP server's tool list is bounded against a listing that never ends, not by what one turn shows a model
ord: 32
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/mcp/src/McpSession.ts
---
The whole tool list a server answers is held for its session, and a server that keeps paging new cursors or answers one enormous page would grow that hold until the listing times out; the byte bound ends such a listing. It is not the tool-output envelope: tools reach a native turn deferred, one schema at a time when the agent reveals it, so a catalog's size never lands in one turn. Taking the output envelope here refused first-party catalogs outright — Google's Gmail server lists 23 tools in about 79 KB. The default stays far above any real catalog, and a declaration may set its own `maxCatalogBytes`; the resource walk for app views uses the same bound.