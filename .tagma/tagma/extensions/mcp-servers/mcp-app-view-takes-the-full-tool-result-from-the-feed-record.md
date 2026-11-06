---
id: 01a123cd-e791-7b03-be5e-f5bcbdc83669
title: MCP App view takes the full tool result from the feed record when it fits the tool-output cap
ord: 3
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1236d-51e7-7552-ad52-dbc10c2dbada
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/mcp/hostStyles.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/views/toolNotices.ts
  - kind: symbol
    ref: packages/mcp/src/mcpToolCatalog.ts
    symbol: mcpViewResult
---
The view is drawn long after the turn, sometimes days later, so the `tool-result` comes from the saved record, not from a live call. The catalog puts the secret-redacted result (`content`, `structuredContent`, `_meta`, `isError`) into `display.app.result` when its JSON fits `TOOL_OUTPUT_MAX_BYTES`. A larger result — usually base64 pictures — is not duplicated into the record whole: the answer text and `structuredContent` stay there, and when even they do not fit, only the text cut to the cap. Images are stored separately as media. The saved output does not fit this: long output is stored as a spool link with a preview.

`display.app.tool` names the tool, and `open_mcp_app` returns its descriptor for `hostContext.toolInfo`. `styles.variables` come from the computed Tagma token values at send time: the host's `var()` does not resolve inside the view's iframe. On a theme or window-size change the view gets `host-context-changed`. The first such notification leaves right after `initialized`: that is how the view learns about changes between the handshake and readiness.
