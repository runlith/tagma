---
id: 01a18975-644d-7413-ab91-26fe9668a6b0
title: Tagma's marketplace carries a plugin for each service it connects to, and the separate connector catalog retires
ord: 3
tags: ["spec"]
fields:
  {
    "status": "open"
  }
---
## What the person gets

Tagma's own marketplace stands first in the catalog, labelled Tagma. It carries a plugin for each service Tagma connects to: Linear, Notion and Sentry. Each is a skill on how to work with that service plus the service's remote MCP server. Installing one connects the service, so the agent both reaches it and knows how to work with it. The same plugins install unchanged in Claude Code and Codex.

## Design

**A service is a plugin, and the connector catalog retires.** A connector and a plugin carrying a remote MCP server are two mechanisms for one thing: declaring a service's server and signing into it. Keeping both makes two places to add a service and two owners of its endpoint. So:
- the `connectors` module retires: `read_connectors`, `connect_service`, `disconnect_service`, `shipped.ts` and its feed;
- the connector list leaves the MCP section;
- a service is reached by installing its plugin from the catalog ([[16e751f3]]).

The MCP section keeps the rows of connected servers, and a plugin's server is named `<plugin>-<server>` as today.

**What carries over.**
- A server connected with `connect_service` keeps working as an ordinary MCP declaration, with its sign-in.
- Its connector mark is dropped by a settings step, so no record names a retired mechanism.
- The person's choice of all projects or this one carries over as the plugin's enabling ([[16e751f3]]).

**The repository.**
- A public repository of the `runlith` organization, `runlith/tagma-plugins`, holds a Claude Code format list and one directory per plugin.
- Each plugin keeps its skills and `.mcp.json` once, and carries a manifest for each client:
  - `.claude-plugin/plugin.json` for Claude Code;
  - `.codex-plugin/plugin.json` for Codex;
  - an Agent Plugins root manifest where it adds reach.
- The builder verifies that each client's published format reads this layout, and validates the list with `claude plugin validate`. Its marketplace `name` avoids reserved names.
- Tagma registers it as the first preset, labelled `tagma`.

**Limits.**
- Two plugins reaching the same service are two servers with two sign-ins.
- A plugin's server tools are classified as plugin servers are today: mutating, with every permission kind.

## Owners

- The new repository.
- `connectors`, retired, and a settings step in `mcp` for the dropped mark.
- `app-mcp`, losing the connector list.
- The preset in `marketplaces`.
- The vocabulary in [[b540be67]] and the connector feature blocks.

## Acceptance

- **The package.** The published revision validates against the Claude Code and Codex formats by `claude plugin validate` and the formats' published definitions. Through the operations, against the test MCP server behind the test authorization server, Tagma installs that revision from a local fixture copy: each plugin's skill is offered, and its server signs in and answers a tool call.
- **What carries over.** A data directory with a server declared by `connect_service` keeps the server and its sign-in after the step, and the mark is gone.
- **What retires.** No `connectors` operation and no connector list remain.

Not performed, and not a gate:
- a live sign-in into the real Linear, Notion and Sentry;
- a run in Claude Code or Codex.
