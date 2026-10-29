---
id: 01a18926-2da8-763c-ae41-cdf18b835e91
title: The agent works with an Agent Plugins, Claude Code or Codex plugin installed unchanged from a folder or a git URL
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
  - kind: dir
    ref: apps/tagma/app/src/lib/features/plugins
---
**Value.** A package written for the agent ecosystem — skills, commands, MCP servers, agents and hooks — works in Tagma without being rewritten for it, so a team keeps one plugin for every agent it uses.

**How.** `install_plugin` takes a folder or a git URL, `enable_plugin` runs it per project, `uninstall_plugin` removes it, `read_plugins` lists what each plugin gives the agent and what Tagma ignores in it with the reason. Its skills and commands join the `$` catalog, its MCP servers the project's pool, its agents the agent library, its command hooks the agent's tool, step and close points — each named `<plugin>-<name>`. In the app the Plugins settings section does the same: it installs from a folder or a git URL, switches a plugin per project, uninstalls it, and shows each plugin's card with what was taken, what is ignored and its options.

**Behaviour.**
- A directory is read as Claude Code when it has `.claude-plugin/plugin.json`, as Codex when it has `.codex-plugin/plugin.json` or a root Agent Plugins `plugin.json` whose `extensions["com.openai"]` is an object, as Agent Plugins when its root `plugin.json` names that schema, and as Claude Code's default layout otherwise; the first of those that applies wins, so a package carrying a Claude and a Codex manifest is read as Claude Code.
- A Codex package gives skills, the stdio and remote servers of its `.mcp.json`, `interface.displayName` as the title and `shortDescription` as the description when none is given, and command hooks from `hooks/hooks.json` or the manifest's `hooks`, run under Codex's tool names, `PLUGIN_ROOT` and `PLUGIN_DATA` and its timeouts. `extensions["com.openai"]` replaces the `.codex-plugin/plugin.json` overlay whole, never merged; the root manifest's identity, `skills/` and `mcp.json` stand either way. `.app.json`, `apps`, `onboardingSkill` and any other field Tagma does not act on are listed as ignored with the reason.
- Installing and enabling ask in review mode for what the plugin runs: each stdio server and each hook command, each remote server it reaches.
- A plugin's MCP server sees only its own format's variables, never Tagma's environment.
- Options a Claude Code plugin asks for are kept in `plugins.options`, secret ones in the key store under the plugin.

**Limits.** Plugin marketplaces, LSP servers, output styles, themes, monitors, `bin/`, plugin settings, ChatGPT app connections, HTTP/MCP/prompt/agent hook handlers, Claude Code and Codex hook events other than the six mapped, and the HTTP+SSE and WebSocket MCP transports are listed as ignored.