---
id: 01a18975-644d-7413-ab91-26fbc8ad5836
title: "A person finds and installs plugins from marketplaces: Tagma's own, the vendors' and any added"
ord: 51
tags: ["spec"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a184a7-bd46-7bf8-8006-9e1db540be67
  - kind: relates
    to: 01a184c6-16dd-744f-b710-46e328ddd18f
---
A person finds plugins in Tagma instead of having to know a plugin's folder or git URL. Tagma reads plugin marketplaces — Tagma's own, the vendors' and any the person adds — shows them in one catalog, and installs from it with one act. The services Tagma connects to ship from Tagma's own marketplace instead of from Tagma's code. The words follow [[b540be67]]; installing a classic plugin is [[63966472]], signing into a service is [[142a1788]] and [[99d9552a]].

**What a marketplace is.** A git repository holding one JSON list of plugins, each with its name, description, author, category and where its files are. There is no marketplace server: Claude Code and Codex read such files, and so does Tagma. Two list formats exist:
- Claude Code: `.claude-plugin/marketplace.json`. Anthropic's `anthropics/claude-plugins-official` holds 315 entries.
- Codex: `.agents/plugins/marketplace.json`. OpenAI's `openai/plugins` holds 65 entries.

Both were counted on 2026-10-29.

**Order.** Each part stands on the one before it.
1. [[38643816]]: Tagma reads marketplaces of both formats and installs from their entries, including the Codex plugin format OpenAI's plugins are written in.
2. [[16e751f3]]: one catalog in the Plugins section shows every added marketplace.
3. [[9668a6b0]]: Tagma's marketplace in its own public repository carries the service connectors and Tagma's plugins for them. The connector list leaves Tagma's code.

**Everyone, no account.** Reading a marketplace needs only network access to a git host. Nothing passes through a Tagma server, and no account is needed.

**Out of scope.**
- A hosted plugin registry and a community directory.
- OAuth clients Tagma registers with services that offer no dynamic registration or client metadata document (Google, GitHub, Slack). These need a hosted sign-in and are separate work.
