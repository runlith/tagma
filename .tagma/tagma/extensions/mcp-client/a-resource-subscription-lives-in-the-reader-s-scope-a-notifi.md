---
id: 01a12317-ec34-7838-b454-781b79683e35
title: A resource subscription lives in the reader's Scope; a notification means re-read the current state
ord: 19
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/mcp/src/McpSession.ts
  - kind: file
    ref: packages/mcp/src/sdk.ts
  - kind: symbol
    ref: packages/mcp/src/mcpToolCatalog.ts
    symbol: mcpToolCatalog
---
`McpSession.subscribeResource` ties the subscription to the mount Scope, so closing one view does not unsubscribe a shared resource held by another. The latest update signal is kept per URI: it invalidates the current state read through `resources/read`, not a journal of events to replay in full. A slow view does not accumulate notifications without bound. MCP Apps use the standard `_meta.ui` shape and the `io.modelcontextprotocol/ui` capability from the official specification https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/draft/apps.mdx; the full descriptor stays with the session, and the model catalog applies `visibility`. `listResources` separately returns entry metadata: per the spec the host takes `_meta.ui` from there when it is missing from the `resources/read` content. The session walks the list once and keeps the `_meta.ui` catalog by URI until the server sends `notifications/resources/list_changed`; the walk is bounded by the same byte count as the tool list, and a resource past the bound gets empty metadata — the strictest CSP. Closing the session ends the subscription stream instead of aborting it, so the holder can resubscribe or name the refusal.
