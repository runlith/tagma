---
id: 01a18896-d952-7778-b11e-381135de6392
title: The operator connects a service Tagma knows in one act, and the agent reads which services are connected
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a184c6-16dd-744f-b710-46e599d9552a
sources:
  - kind: dir
    ref: apps/tagma/server/src/connectors
  - kind: file
    ref: apps/tagma/app/src/lib/features/mcp/Connectors.svelte
---
**Value** — reaching a service account takes no MCP address, header or client to look up: the person picks the service and signs in.

**How** — the Connectors list at the top of the MCP servers settings; `connect_service` and `disconnect_service` for the operator, `read_connectors` for agents.

**Behaviour** — connecting declares the service's remote MCP server on the page's scope, carrying the connector's mark, and opens its sign-in page, or waits for its key on the server's card. The connected service is that MCP server: its card shows the service's name and icon, and its state is the server's. Disconnecting drops the server with its tokens, values and client registration. A catalog entry whose address moved shows "moved to a new address" and offers to reconnect. In a project that turns off the operator's own servers, a service connected for all projects reads "connected, off in this project".

**Limits** — only services whose own MCP server signs in with no client the person registers are in the catalog; any other is connected by URL as an MCP server. An agent never connects or signs in; it asks the operator.