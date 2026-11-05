---
id: 01a14c08-8336-7b3c-965a-b09415a61526
title: "An agent builds a plugin in Tagma's format as a directory in the project and runs it with no deploy: one process per machine, enabled per project"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928acad90fdf
sources:
  - kind: file
    ref: apps/tagma/server/src/plugin-host/generation.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/supervisor.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-formats/tagma/manifest.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/doctrine/plugins.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/ProcessStep.svelte
---
**Value.** A plugin inside Tagma — a CRM, a trading desk, a tracker bridge, a game — an agent writes as a directory in the project and runs with no deploy and no Tagma change.

**How.** A directory with a hand-written `tagma-plugin.json`, by convention in the project's `.tagma-plugins/<id>/`. The agent installs it from that folder (`install_plugin`, read in place), runs or stops it per project or in every project (`enable_plugin`), removes it (`uninstall_plugin`), and reads its state (`read_plugins`, whose row carries the process). The Plugins screen lists it beside the other formats' plugins with its process state. The built-in `plugins` skill explains to an agent how to write, connect and debug one.

**Behaviour.**
- The manifest carries the id, title, options, an optional process — any program speaking MCP over stdio — and contributions by points. A plugin without a process is views and agents only.
- A manifest or a contribution its point rejects refuses the install with the reason; a point that cannot register against the running process — a tool it does not serve, a view `views` does not name — shows as the process failing, with the reason.
- One process per machine serves all projects and runs while any project enables the plugin. Uninstalling stops it everywhere and drops its secrets; neither its folder nor its data is touched.
- Editing the plugin's files or options restarts the process; `ui/`, dependencies, `.git` and what its `.gitignore` names do not. A restart waits for started calls, new ones wait for the next process; a crashed process restarts with an increasing delay. A bad manifest after an edit keeps the old process working.
- The process gets the server address, its caller address, a data directory and its options in env, and calls those Tagma operations that are open to an outside caller: thread births and turns, reading them, notifications, pins, worktree removal, the browser.
- The process runs as the operator's OS user; installing names the command it runs for the operator's consent.

**Limits.** The manifest is written by hand: nothing builds it from code. A plugin's contributions stand only while its process generation is registered, so a stopped or failed process withdraws its tools and views.
