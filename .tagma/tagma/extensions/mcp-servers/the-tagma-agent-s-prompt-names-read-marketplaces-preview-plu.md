---
id: 01a19941-f43b-740d-a329-7c4d0ea5d1b0
title: The tagma agent's prompt names read_marketplaces, preview_plugin and install_plugin, which its capabilities do not mount
ord: 17
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a19936-a37c-7195-9f5a-00e4107b9e9b
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/doctrine/mcpServers.ts
---
`library.itest.ts › every agent this server ships is a read-only built-in of any project, whose prompt names only operations its capabilities mount` fails for `tagma` with `unmounted: [install_plugin, read_marketplaces, preview_plugin]`. The MCP servers doctrine section, added by `2c7f3ecc7` (feat(mcp): have the agent find and install the plugin a task needs), tells the agent to call them, while their tools sit on the `plugins` capability, which the built-in `tagma` definition does not hold. Either the definition takes that capability, or the sentence leaves the section; which one is the product's choice of whether the agent installs plugins itself.