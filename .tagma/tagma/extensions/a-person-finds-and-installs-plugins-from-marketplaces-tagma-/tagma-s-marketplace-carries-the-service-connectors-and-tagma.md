---
id: 01a18975-644d-7413-ab91-26fe9668a6b0
title: Tagma's marketplace carries the service connectors and Tagma's plugins for them, and a service is signed into once
ord: 3
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
## What the person gets

Tagma's own marketplace stands first in the list, labelled Tagma. It carries plugins for the services Tagma connects to: Linear, Notion and Sentry. Each is a skill on how to work with that service, plus the service's remote MCP server. Installing one connects the service, so the agent both reaches it and knows how to work with it.

The same plugins install unchanged in Claude Code and Codex, which read the same files. A service is signed into once, whichever plugin reaches it: Tagma's, Anthropic's, OpenAI's, or one the person added.

## Design

**The repository.**
- A public repository of the `runlith` organization, `runlith/tagma-plugins`, created by this work on the operator's word given 2026-10-29.
- It holds a Claude Code format list, plugins in a format Claude Code and Codex read unchanged, and the connector entries.

**Connectors leave Tagma's code.**
- The entries of `connectors/shipped.ts` move into a file of that repository that only Tagma reads.
- The marketplaces module fills the `ConnectorCatalog` port from it, and `shipped.ts` is deleted, so the list has one source.
- A Tagma release no longer gates a new service. A Tagma plugin and the connector it needs ship together.

**One sign-in per service.**
- A plugin's remote MCP server whose canonical URL (the MCP spec's canonical server URI) equals a connector's URL is not declared as a second server. In the project where the plugin is enabled, it binds to that service's connection.
- When the service is not yet connected there, enabling the plugin starts the connector's connect.
- A remote server with no matching connector stays the plugin's own server, as today.
- This holds for every plugin, so a vendor's plugin for a service Tagma knows shares the same connection.

**The catalog becomes the one place.** The connector list leaves the MCP section. The MCP section keeps the connected servers' rows, and their mark names the service.

**Already-connected services keep working.** A declaration written by `connect_service` before this change keeps its mark and its sign-in.

## Owners

- The new repository.
- `connectors`, whose catalog source changes, and the `shipped.ts` deletion.
- `marketplaces`.
- `plugins`, for binding a remote server to a connector.
- `mcp` rows.
- `app-mcp`, losing the connector list.
- `app-plugins`.

## Acceptance

- `read_connectors` answers the entries read from a fixture marketplace repository holding a connector file, and no built-in list stands.
- Two plugins whose remote servers name one connector URL, enabled in one project, produce one MCP server and one sign-in; signing in through either connects both.
- Enabling a plugin for an unconnected service starts the connect.
- The three Tagma plugins install from the published repository in Tagma; their skills are offered and their service connects. In Claude Code and Codex this is checked by reading the files against each client's published format, not by a live run.
