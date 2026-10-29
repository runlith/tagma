---
id: 01a18925-fada-7c2c-a186-142d39cdfe48
title: Install and enable consent is computed before the act from the plugin as read, so a git URL or a marketplace entry is fetched into its own staging directory first
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
`install_plugin` and `enable_plugin` raise an `execute` subject for every stdio MCP server and every command hook, a `network` subject for every remote server, and `mcp-env-resolving` for a server setting a resolving variable, exactly as `add_mcp_server` does for the same server; secret option values in them are masked. Those subjects exist only once the package is read, so the operation's prepare step reads it; for a git URL or a marketplace entry that means fetching before the operator answers — a git source cloned shallow at its ref or pinned commit, an entry's folder copied — into a staging directory of that preparation alone, so two preparations of one source never overwrite what the other approved. The staged revision is held under a token: `preview_plugin` hands it out and `install_plugin` with `prepared` installs exactly what was previewed without fetching again; a held revision is dropped a day after it was prepared, and staging is cleared when the server starts. Installing with `enabled: false` still asks when the plugin already runs in another project, since the new version replaces it there at once. The act, under the one lock all plugin installs and enablings share, rereads the staged package, refuses if it names another plugin, checks collisions in every project that will run it, and only then swaps the staged copy into `agent-plugins/<id>/`, keeping the former copy until the new one is in place. Cloning runs no code of the plugin; disabling reads nothing, so a plugin whose directory became unreadable can still be switched off.