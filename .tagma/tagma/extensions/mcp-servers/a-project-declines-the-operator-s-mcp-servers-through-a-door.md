---
id: 01a18896-7c08-734c-b044-3f45356917d4
title: A project declines the operator's MCP servers through a door, and its connectors read connected, off in this project
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18881-b4e6-7d5c-8ed1-51293e11cd9b",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18816-519c-7c83-bdca-b99294978b89
  - kind: relates
    to: 01a184c6-16dd-744f-b710-46e599d9552a
---
The MCP resolution already honours a project layer that declines `mcp.servers` (`mcpDeclared`, the secret holders), but no door writes that flag: `mcp.servers` is managed by `add_mcp_server` and registers no managed writer, so `write_setting_layer` refuses it `setting-managed`, and the MCP section offers no control.

Give `mcp.servers` a managed writer that changes only the project layer's `declined` flag and reconciles that project's pool, and a switch in the MCP section. Then `read_connectors` answers a connector declared for all projects as connected, off in this project, in a project that declines them — the part of [[99d9552a]] left for this door. Proof: through `write_setting_layer` and `read_connectors` against the MCP test servers.