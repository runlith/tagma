---
id: 01a1b2e7-1593-736b-acf9-7b8446bba31b
title: A plugin brings MCP servers, and its process and views call them under the servers' own sign-in
ord: 13
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-8336-7b3c-965a-b0997b731471
  - kind: relates
    to: 01a184a7-bd46-7bf8-8006-9e1db540be67
sources:
  - kind: file
    ref: apps/tagma/server/src/mcp/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-formats/tagma/contract/wire/manifest.ts
  - kind: file
    ref: packages/tagma/src/plugin/servers.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugin-views/client.svelte.ts
---
**Value.** A plugin that works with a service needs no credential of its own: the MCP server it brings signs in once, as the person, and the plugin's process and its views call that server's tools through Tagma. A service section in Tagma is a view over the service's own server.

**How.** `mcpServers` in `definePlugin`; `ctx.servers.<name>.call(tool, input)` in a handler, `ctx.servers.in(projectId)` for another project; `useTagma().servers.<name>.call(tool, input)` in a view. Below them is the `mcp` operation `call_contributed_tool`.

**Behaviour.**
- The servers join the MCP server list of every project running the plugin, as `<plugin>-<name>`, and are switched with the plugin. Installing and enabling ask to run each stdio server and reach each remote one.
- A plugin reaches only the servers it brought, and only in a project where it runs. A project or user declaration of the same name takes the name over, and the plugin's call then refuses instead of reaching that other server.
- The server sees who calls: the plugin's process as Tagma acting for the plugin, a view as the operator acting in that view and thread.
- The answer is the server's tool result as MCP shapes it. A failed result is the server's answer, not a refusal.

**Limits.** A plugin cannot call a server another plugin brought, or one the person declared. Signing in is the person's, from the server's card.
