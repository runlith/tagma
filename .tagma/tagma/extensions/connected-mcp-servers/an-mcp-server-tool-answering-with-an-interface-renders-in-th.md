---
id: 01a14c08-8336-7b3c-965a-b093aac686d3
title: An MCP server tool answering with an interface renders in the feed as an isolated MCP App view, and the operator works in it
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76d6-793a-939b-838f9b8c75ed
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b0924e9cc089
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/mcp/AppView.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/mcpApps.feed.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/mcp/ViewBridge.ts
  - kind: file
    ref: apps/tagma/server/src/mcp/sandbox.ts
  - kind: file
    ref: packages/mcp/src/mcpApps.ts
---
**Value.** An MCP server tool that answers with an interface — a chart, a form, a player — shows in the thread feed as that interface, and the operator works in it in place.

**How.** An MCP App card in the feed: when a tool call carries a view under the MCP Apps spec, the feed draws the view instead of the plain card. Below it — the operator operations `open_mcp_app`, `read_mcp_resource`, `call_mcp_app_tool`.

**Behaviour.**
- The view gets the call's input and result from the feed record, so it opens days after the turn; an oversized result arrives cut down to text.
- The view may only call its own server's tools open to the app, read and subscribe to its resources, and open links on click; it cannot act in Tagma on the operator's behalf.
- Foreign HTML is isolated in two layers — a proxy on a separate origin and a nested frame with no origin of its own — plus a CSP with this machine's addresses and bare IPs thrown out.
- If the server name has since been re-declared, the old view refuses instead of talking to the new server. Opening a view raises only its server, not the project's whole pool.
- The view receives Tagma's theme tokens and learns of theme and size changes.

**Limits.** Views only work while the server holds the sandbox origin: on the phone — the second Tailscale Serve port; its failure switches off MCP App views and nothing else. In Safari without `moveBefore`, closing a view may flash the previous thread for a moment.
