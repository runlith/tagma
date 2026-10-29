---
id: 01a184a7-bd46-7bf8-8006-9e1db540be67
title: MCP server, connector, plugin and app are four different extensions
ord: 38
---
Tagma names four ways to extend what agents and people can do. Each word means one thing:

- **MCP server** is the wire: a program or URL whose tools an agent calls over MCP. A server may attach interactive windows to its tools through the MCP Apps extension, and Tagma renders them in the feed. Such a window belongs to the server; it is not a fifth kind of extension.
- **Connector** is access to a service account on the user's behalf. It combines a remote MCP server, a sign-in (OAuth) and a place for the token: the machine, or a hosted account. One catalog entry serves both places. Connecting one declares an ordinary MCP server carrying the connector's mark.
- **Plugin** is the classic package that changes how an agent works: skills, MCP servers, hooks, commands and agents. It uses the format the agent ecosystem already shares (Agent Plugins 1.0, Claude Code plugins). Tagma reads that format as-is, so existing plugins install unchanged. Not built yet.
- **App** is a product inside Tagma: its own process, interface, data and agents, with access to Tagma's graph, threads and agents. An app may require connectors and use plugins. Its declaration is Tagma's own and follows no outside standard. The interface calls it an app, the outside world a Tagma App. In code it is `TagmaApp`: a bare `app` already names the Tagma client, and "MCP App" is the protocol's tool window. Today's code still calls apps plugins.

These are separate words because each answers a different question. A connector says where an agent may go, a plugin says how it works, and an app is what a person uses inside Tagma. Fitting apps into the plugin package format would tie them to a standard made for agent configuration. Calling them plugins would give the word a meaning different from every neighbouring tool.
