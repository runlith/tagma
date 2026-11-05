---
id: 01a184a7-bd46-7bf8-8006-9e1db540be67
title: MCP server and plugin are two different extensions, and a connector is a plugin carrying a service's server
ord: 38
---
Tagma names two ways to extend what agents and people can do. Each word means one thing:

- **MCP server** is a connection: a program or URL whose tools an agent calls over MCP, with its secrets and sign-in, and no author, version or files. A server may attach interactive windows to its tools through the MCP Apps extension, and Tagma renders them in the feed. Such a window belongs to the server; it is not a further kind of extension. MCP servers keep their own list.
- **Plugin** is everything else a person adds, from a skill to a whole application inside Tagma. A plugin in Tagma's format (`tagma-plugin.json`, module `plugins`) may run its own process and contribute tools, views, sections, agents, schedules and notifications. A plugin written for the agent ecosystem — Agent Plugins 1.0, Claude Code, Codex — brings skills, MCP servers, hooks, commands and agents and installs unchanged through the same `install_plugin`. A plugin may bring MCP servers into the servers' list. A plugin carrying a service's remote MCP server is how a person reaches a service account: the server signs in as them, and the plugin's skill says how to work there. Tagma's own marketplace carries such plugins for the services it connects to. *Connector* names such a plugin, never a mechanism of its own.

These are separate words because each answers a different question: an MCP server is what an agent calls, a plugin is what changes how agents work and what a person uses inside Tagma. "App" is no product term; in Tagma's code a bare `app` names the Tagma client, and "MCP App" is the protocol's tool window.
