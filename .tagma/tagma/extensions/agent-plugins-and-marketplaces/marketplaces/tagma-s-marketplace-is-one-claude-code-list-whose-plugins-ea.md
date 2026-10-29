---
id: 01a18a03-1ee2-7b59-af96-04ec1f42afc5
title: Tagma's marketplace is one Claude Code list whose plugins each carry a Claude Code and a Codex manifest over one skill and one .mcp.json
ord: 6
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18975-644d-7413-ab91-26fe9668a6b0
sources:
  - kind: file
    ref: apps/tagma/server/src/marketplaces/contract/wire/presets.ts
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/plugins/tagma-plugins
---
The public repository `runlith/tagma-plugins` is the marketplace Tagma registers as its `tagma` preset. `composition/testing/plugins/tagma-plugins` is a copy of its published revision (`ed6fee3`), which the acceptance itest installs with each server's URL swapped for the test OAuth server; a change to the repository lands in that copy in the same work.

- One list serves every client. Codex reads `.claude-plugin/marketplace.json` as well as its own `.agents/plugins/marketplace.json`, and Tagma reads either, so a second list would only drift from the first.
- Each plugin keeps its skill and its `.mcp.json` once. `.claude-plugin/plugin.json` finds them by Claude Code's default layout, and `.codex-plugin/plugin.json` names them through `skills` and `mcpServers`. Tagma reads the plugin as Claude Code, the format its list entry declares.
- There is no Agent Plugins root `plugin.json`. With one, Codex — and Tagma's Codex reader — read `mcp.json` in place of `.mcp.json`, so every server would be declared twice, and no client is known that reads only that format.
- A server is named after its service, as Anthropic's and OpenAI's own plugins name theirs, so Tagma offers it as `linear-linear`. It carries no `oauth_resource` hint: each server signs in from its URL.
- The list is named `tagma`, outside the names Claude Code reserves for Anthropic's marketplaces, so a person installs `linear@tagma` in Claude Code and Codex alike.
