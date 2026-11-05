---
id: 01a1236d-51e7-7552-ad52-dbc10c2dbada
title: "The MCP Apps host: mounting cost, view limits, and the host's full context"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1231d-b9cc-7eb6-be22-add828aa44c4",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1231d-99c0-74e1-9e30-779efe94e581
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The remainder of the `159b403db` delivery review (the MCP Apps host), not closed in it. Each item verified against the code; none breaks isolation.

- **Mounting cost.** Each view mounting re-calls `open_mcp_app`: a session ping, `resources/read`, the whole HTML over the wire; scrolling back repeats it and restarts the view. Each view `tools/call` and `resources/read` also pays a ping in `McpPool.live`. The per-(identity, uri) document cache sits at `McpSession`, dropped by `notifications/resources/list_changed` and that URI's `resources/updated`.
- **Opening an old thread raises all of the project's MCP servers.** `serving` in `mcp/serverPool.ts` does `reconcile` when the project's pool is not open. Raise only the view's server, or accept explicitly.
- **Row-height estimate.** A row with a view has no `estimate` (`UNDERIVED_PX` against ~350 px), hence scroll jumps.
- **The resource blob decodes on the event loop with no limit** (`mcpApps.ts`, `textOf`): a byte limit on the document and decoding without a per-character callback are needed.
- **Mounting limits:** the view's outstanding request count and `size-changed` frequency are unbounded.
- **`tool-result` assembles from the saved output** (text + structuredContent): the result's `_meta` and non-text parts never reach the view.
- **`hostContext`:** no `toolInfo`, `styles.variables`, `host-context-changed` on theme change; `innerHeight` in `ViewFrame` reads non-reactively.
- **The remote door** shows no views: the sandbox origin is loopback; a second Tailscale Serve port is the stage-2 remote-door task.

Done when a view that left the window and returned does not re-read HTML from the server, and opening a thread raises only the needed server.
