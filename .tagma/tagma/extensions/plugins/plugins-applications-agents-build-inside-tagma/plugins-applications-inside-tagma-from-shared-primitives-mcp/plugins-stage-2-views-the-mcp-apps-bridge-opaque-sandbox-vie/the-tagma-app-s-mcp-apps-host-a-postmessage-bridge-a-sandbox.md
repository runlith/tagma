---
id: 01a1231d-99c0-74e1-9e30-779efe94e581
title: "The Tagma app's MCP Apps host: a postMessage bridge, a sandbox proxy on a separate origin, a foreign MCP App's view in a tool's result"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1231d-b9cc-7eb6-be22-add828aa44c4",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1227f-7522-78e3-a658-79b7a0a16218
---
The spec's “View and bridge” section: the MCP Apps bridge (JSON-RPC over postMessage, `ui/initialize`, `tools/call`, `resources/read`/`subscribe`, context, sizes, teardown), the host binding the connection to the mounting, two isolation layers (a proxy on a separate sandbox origin with `allow-scripts allow-same-origin`, the view inside it opaque with no `allow-same-origin`, CSP with `'wasm-unsafe-eval'`, `allow` for pointer lock, fullscreen, sound), a missing capability answering `unavailable`.

The first consumer is a foreign MCP App from the project's MCP server: a tool with `_meta.ui.resourceUri` draws its view in its ribbon entry, the view calls only its own server's tools with `visibility` app, all `tagma/*` are `unavailable`. The `packages/mcp` client side is already in place (`6e3189e524`, `7269d2a326`); the resource's `_meta.ui` is taken from `listResources` when `readResource` lacks it. Plugin views, `tagma/*`, and the remote door connect on the same bridge in the stage's next tasks.

Done when a real stdio MCP server with a UI resource and no Tagma SDK shows its view in the ribbon on desktop and web, the view calls its tool and gets the result, the iframe cannot name itself another server, and mounting subscriptions drop when it unmounts.
