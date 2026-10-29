---
id: 01a18926-2da8-763c-ae41-cdf18b835e91
title: The agent works with an Agent Plugins or Claude Code plugin installed unchanged from a folder or a git URL
ord: 5
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/plugins.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/operations.ts
---
**Value.** A package written for the agent ecosystem — skills, commands, MCP servers, agents and hooks — works in Tagma without being rewritten for it, so a team keeps one plugin for every agent it uses.

**How.** `install_plugin` takes a folder or a git URL, `enable_plugin` runs it per project, `uninstall_plugin` removes it, `read_plugins` lists what each plugin gives the agent and what Tagma ignores in it with the reason. Its skills and commands join the `$` catalog, its MCP servers the project's pool, its agents the agent library, its command hooks the agent's tool, step and close points — each named `<plugin>-<name>`.

**Behaviour.**
- A directory is read as Claude Code when it has `.claude-plugin/plugin.json`, as Agent Plugins when its root `plugin.json` names that schema, and as Claude Code's default layout otherwise; a package carrying both manifests is read as Claude Code.
- Installing and enabling ask in review mode for what the plugin runs: each stdio server and each hook command, each remote server it reaches.
- A plugin's MCP server sees only its own format's variables, never Tagma's environment.
- Options a Claude Code plugin asks for are kept in `plugins.options`, secret ones in the key store under the plugin.

**Limits.** Plugin marketplaces, LSP servers, output styles, themes, monitors, `bin/`, plugin settings, HTTP/MCP/prompt/agent hook handlers, Claude Code hook events other than the six mapped, and the HTTP+SSE and WebSocket MCP transports are listed as ignored. The plugin page in the app is not built yet.