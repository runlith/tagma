---
id: 01a184c6-16dd-744f-b710-46e328ddd18f
title: "Agents reach outside protocols in three layers: MCP sign-in, connectors, classic plugins"
ord: 43
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a184a7-bd46-7bf8-8006-9e1db540be67
---
Tagma extends agents through outside protocols in three layers. Each layer is built on the one below, and they ship in this order. The words follow [[b540be67]].

1. **MCP: one key store and sign-in.** Every secret Tagma hands to a process lives in one store. A remote MCP server that asks for OAuth is signed into from its card, and no token is typed by hand.
2. **Connectors.** A catalog of services, where one act connects a service. A connector is a remote MCP server plus its sign-in. A connected service is an ordinary MCP server row, and nothing runs beside the MCP pool.
3. **Plugins.** Today's in-Tagma applications are renamed `TagmaApp`, which frees the word. Tagma then reads the classic plugin format the agent ecosystem shares and installs those packages unchanged.

**Why this order.** Each layer is a strict superset of the one below: a connector is an MCP server with a sign-in, and a plugin carries MCP servers and secrets. Building from the bottom means every layer reuses a finished mechanism instead of growing its own. The duplication found today goes in layer 1: a secret reaches an MCP server from the process environment, and reaches an app from its own file. Layer 3 needs the rename first, because today's app manifest is a root `plugin.json`, the same path as a classic plugin manifest.

**Local and hosted.** Every layer is complete on one machine with no account: secrets, tokens and the catalog stay local. A hosted Tagma account may later hold tokens and serve the catalog. The local design keeps that possible through two contracts, and adds no second implementation now:
- the MCP pool takes a server's bearer through a two-call contract beside the declaration;
- the connector catalog reads entries of one shape, whatever their source.

**Out of scope.** Plugins for external CLI harnesses, which keep their own plugin systems.
