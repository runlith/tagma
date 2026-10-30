---
id: 01a18e80-167a-7c74-a6e6-363a91fe79a9
title: Agents add the plugin a task needs, and what waits on the person in plugins reaches Attention
ord: 27
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a18e6c-7bbb-7241-82cc-ea20753ba256
---
## What the person gets

A person who never opens the Plugins place still gets a service connected: asked about their Linear issues, the agent finds Linear's plugin, asks to add it, and the person answers with one press and a sign-in. Whatever waits on the person in plugins — a sign-in, a missing value — reaches them wherever they are, not only on the place's list.

- **The agent finds and adds.** When a task needs a service no server in the project reaches, the agent looks in the catalog (Tagma's own marketplace first), previews the plugin and installs the prepared revision. The install's consent is the operation's own review: in a thread that asks, the person sees what the plugin reaches and runs and approves it.
- **The sign-in follows the add.** The installed step in the feed names the plugin and links to its page, where the sign-in waits; the thread says it waits on the person until the server is signed in, then the agent goes on without a new message.
- **Attention.** A server that waits on a sign-in or a value is a row in Attention and marks the Plugins rail icon; the row opens the plugin's page.
- **In the composer**, `$` lists a plugin's skills with the plugin's name, and its last row searches the catalog for what was typed.
- **Removing a plugin** drops the sign-in of the servers it brought, so no connection outlives the plugin that made it.

## Design

- The doctrine of `mcp` and `plugins` tells the agent the path above instead of asking the person to install.
- The install's tool display carries a reference to the plugin, which the app opens as the plugin's page.
- A waiting server becomes an operator notification of the `mcp` sender, opened when it starts waiting and closed when it stops, so Attention and the phone take it with no new list.
- The composer's `$` source names the plugin a skill came from; the find row is the app's, opening the place with the query.

## Acceptance

- Through the operations: an agent's `install_plugin` of a plugin whose server asks for a sign-in leaves an open `mcp` notification naming it; signing in closes it.
- Uninstalling a plugin leaves none of its servers' tokens.
- `bun run typecheck` for the app and server passes.
