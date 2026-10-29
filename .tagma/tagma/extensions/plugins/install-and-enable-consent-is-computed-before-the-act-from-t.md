---
id: 01a18925-fada-7c2c-a186-142d39cdfe48
title: Install and enable consent is computed before the act from the plugin as read, so a git URL is cloned into staging first
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/plugins/sources.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/consent.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/operations.ts
---
`install_plugin` and `enable_plugin` raise an `execute` subject for every stdio MCP server and every command hook, a `network` subject for every remote server, and `mcp-env-resolving` for a server setting a resolving variable, exactly as `add_mcp_server` does for the same server. Those subjects exist only once the package is read, so the operation's prepare step reads it; for a git URL that means cloning before the operator answers. The clone goes to `plugins/.staging/<hash of the URL>/` and only the act moves it to `plugins/<id>/`, so a declined install leaves the installed clone untouched and a repeated prepare of the same URL replaces its own staging copy instead of piling up. Cloning runs no code of the plugin. Disabling reads nothing, so a plugin whose directory became unreadable can still be switched off.