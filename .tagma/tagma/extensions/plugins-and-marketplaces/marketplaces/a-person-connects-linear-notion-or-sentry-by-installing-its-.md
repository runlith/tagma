---
id: 01a18896-d952-7778-b11e-381135de6392
title: A person connects Linear, Notion or Sentry by installing its plugin from Tagma's marketplace, and the agent knows how to work there
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a184c6-16dd-744f-b710-46e599d9552a
  - kind: relates
    to: 01a189aa-af25-74f6-a2b5-421c57e5f6ba
sources:
  - kind: file
    ref: apps/tagma/server/src/marketplaces/contract/wire/presets.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/operations.ts
---
**Value** — reaching a service account takes no MCP address, header or client to look up, and the agent arrives knowing how to work there: the person installs the service's plugin and signs in.

**How** — Tagma's own marketplace stands first in the Plugins settings catalog, labelled Tagma, with a plugin for Linear, Notion and Sentry. Each plugin carries a skill on working with the service and the service's remote MCP server; installing it from the catalog, for this project or every project, adds both.

**Behaviour** — installing connects the plugin's remote server in that project at once, named `<plugin>-<server>` (`linear-linear`), and the plugin's card offers its sign-in, which the person starts; the skill joins the agent's catalog as `<plugin>-<skill>`. A server a person connected earlier through the retired connector list stays an ordinary MCP server with its sign-in; installing the plugin beside it adds a second server with a sign-in of its own. The marketplace is the public repository `runlith/tagma-plugins`, whose plugins install unchanged in Claude Code and Codex.

**Limits** — an agent's install never signs in; the person does. Two plugins reaching one service are two servers and two sign-ins. Any other service is connected by its URL as an MCP server, or by a plugin from another marketplace.
