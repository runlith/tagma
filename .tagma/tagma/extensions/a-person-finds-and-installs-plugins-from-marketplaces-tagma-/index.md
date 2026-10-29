---
id: 01a18975-644d-7413-ab91-26fbc8ad5836
title: "A person finds and installs plugins from marketplaces: Tagma's own, the vendors' and any added"
ord: 51
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a184a7-bd46-7bf8-8006-9e1db540be67
  - kind: relates
    to: 01a184c6-16dd-744f-b710-46e328ddd18f
---
A person finds plugins in Tagma instead of having to know a plugin's folder or git URL. Tagma reads plugin marketplaces — Tagma's own, the vendors' and any the person adds — shows them in one catalog, and installs from it with one act. The services Tagma connects to become plugins of Tagma's own marketplace, so one catalog holds every ability. The words follow [[b540be67]]; installing a classic plugin is [[63966472]], and signing into a remote MCP server is [[142a1788]].

**What a marketplace is.** A git repository holding one JSON list of plugins, each with where its files are. There is no marketplace server. Two list formats exist: Claude Code's and Codex's, read in [[43cce814]].

**Order.** Each part stands on the one before it.
1. [[38643816]]: Tagma reads marketplaces of both formats and installs from their entries, including the Codex plugin format.
2. [[16e751f3]]: one catalog in the Plugins section shows every added marketplace.
3. [[9668a6b0]]: Tagma's marketplace in its own public repository carries plugins for the services Tagma connects to, and the separate connector catalog retires.

**Everyone, no account.**
- Reading a marketplace needs only network access to a git host.
- An installed plugin works offline, and nothing passes through a Tagma server.

**Out of scope.**
- A hosted plugin registry and a community directory.
- OAuth clients Tagma registers with services that offer neither dynamic registration nor a client metadata document.
- Sharing one sign-in between two plugins that reach the same service.
