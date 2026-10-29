---
id: 01a184a7-bd46-7bf8-8006-9e1db540be67
title: MCP server, plugin and app are three different extensions, and a connector is a plugin carrying a service's server
ord: 38
---
Tagma names three ways to extend what agents and people can do. Each word means one thing:

- **MCP server** is the wire: a program or URL whose tools an agent calls over MCP. A server may attach interactive windows to its tools through the MCP Apps extension, and Tagma renders them in the feed. Such a window belongs to the server; it is not a fourth kind of extension.
- **Plugin** is the classic package that changes how an agent works: skills, MCP servers, hooks, commands and agents. It uses the format the agent ecosystem already shares (Agent Plugins 1.0, Claude Code plugins, Codex plugins). Tagma reads that format as-is, so existing plugins install unchanged (`install_plugin`, module `plugins`). A plugin carrying a service's remote MCP server is how a person reaches a service account: the server signs in as them, and the plugin's skill says how to work there. Tagma's own marketplace carries such plugins for the services it connects to. *Connector* names such a plugin, never a mechanism of its own.
- **App** is a product inside Tagma: its own process, interface, data and agents, with access to Tagma's graph, threads and agents. An app may use plugins, including those that reach a service. Its declaration is Tagma's own and follows no outside standard. The interface calls it an app, the outside world a Tagma App. In code it is `TagmaApp`: a bare `app` already names the Tagma client, and "MCP App" is the protocol's tool window.

These are separate words because each answers a different question. An MCP server is what an agent calls, a plugin says how the agent works and which services it reaches, and an app is what a person uses inside Tagma. Fitting apps into the plugin package format would tie them to a standard made for agent configuration. Calling them plugins would give the word a meaning different from every neighbouring tool.
