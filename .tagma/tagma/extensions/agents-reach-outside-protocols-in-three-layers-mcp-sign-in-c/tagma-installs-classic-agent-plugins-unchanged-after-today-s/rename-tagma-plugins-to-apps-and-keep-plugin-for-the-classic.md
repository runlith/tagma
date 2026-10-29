---
id: 01a184a8-3e06-76c9-9448-916b05a933b6
title: Rename Tagma plugins to apps and keep "plugin" for the classic agent package
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a188ac-1de7-74d2-b417-8fa8c4665946",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a184c6-16dd-744f-b710-46e663966472
  - kind: relates
    to: 01a184a7-bd46-7bf8-8006-9e1db540be67
  - kind: waits-on
    to: 01a18816-519c-7c83-bdca-b99294978b89
---
What the code calls a plugin is an app inside Tagma: its own process, views, agents, secrets and schedules. The word "plugin" stays free for the classic agent package. Rename now: every app still lives in this monorepo, and no outside author depends on the names yet.

Scope:
- the server modules `plugins` and `views`;
- their operations (`install_plugin`, `enable_plugin`, `uninstall_plugin`, `read_plugins`, `read_plugin_schema`);
- the project and machine directories (`.plugins/`, `plugins/` in the data directory) and the manifest `plugin.json`, renamed `tagma-app.json` because the Agent Plugins manifest stands at the same root path;
- the tool prefix `plugin__<id>__<tool>` and the capability `plugin:<id>`;
- the app module `app-plugins`, the `plugins` skill and the interface words;
- the graph blocks under these modules.

The code name is `TagmaApp` (`tagma-app`, `tagmaApp` in files, ids and variables), an exception the global naming rule names. A bare `app` already means the Tagma client: `apps/tagma/app`, the `app-*` module ids and the layer's `App`. "MCP App" stays the name of an MCP server's tool window (the MCP Apps extension), which Tagma hosts beside app views. The interface says "Apps"; outside Tagma, "Tagma Apps".

Stored installs, enablings, secrets and data move to the new names on the first start of the build that carries the rename, so nobody reinstalls.
