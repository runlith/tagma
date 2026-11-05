---
id: 01a18925-faec-71bc-b75c-80e8fee0ae2d
title: "A plugin's MCP server declarations are final when they leave the plugins module: expanded by their format only, mutating with every permission kind"
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugin-formats/agent-plugins/servers.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-formats/claude-code/variables.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/shelf.ts
---
The format adapter expands its own variables against the plugin's place — Agent Plugins `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` in args, env and cwd; Claude Code `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}`, `${CLAUDE_PROJECT_DIR}` and `${user_config.KEY}` — and the core adds the classification, so the MCP pool receives a declaration it never expands again: a `${HOME}` a plugin writes into a header is sent literally instead of leaking Tagma's environment to a remote server. Classifying every plugin server as mutating with all permission kinds makes its tools ask in review mode, since a package author's own classification is not the operator's judgement. Secret option values used in a declaration travel beside it as values to redact.