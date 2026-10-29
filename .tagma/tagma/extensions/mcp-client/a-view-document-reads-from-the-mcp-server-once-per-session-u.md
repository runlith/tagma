---
id: 01a123cd-e73c-70e0-ab1f-1044d429abb8
title: A view document reads from the MCP server once per session, until the server reports it changed
ord: 20
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1236d-51e7-7552-ad52-dbc10c2dbada
sources:
  - kind: file
    ref: packages/mcp/src/mcpApps.ts
  - kind: symbol
    ref: packages/mcp/src/McpSession.ts
    symbol: McpSession
---
A tool-result view unmounts when it scrolls out of view and mounts again on return. Without a cache every return would re-read the HTML from the server. `McpSession.appDocument` holds the document by URI and drops it on `notifications/resources/list_changed` (all documents) and on `resources/updated` for that URI. A server that changes HTML without reporting it serves the new document only after session reconnect: per spec the host has nothing else to listen for.

A document longer than `MCP_APP_DOCUMENT_MAX_LENGTH` characters is refused before blob decoding. One session's cache is capped at the same number, counting URI, HTML and metadata, and evicts long-unopened documents, so the largest allowed document fits in it. A read puts the result in the cache only if no reset of that URI or of the list arrived during the read and no newer read of the same URI started. Updates of other resources do not affect this.
