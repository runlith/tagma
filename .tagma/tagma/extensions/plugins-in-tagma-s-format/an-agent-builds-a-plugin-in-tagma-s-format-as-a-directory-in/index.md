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
    ref: apps/tagma/server/src/plugin-formats/tagma/contract/wire/manifest.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/doctrine/plugins.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/ProcessStep.svelte
  - kind: file
    ref: packages/tagma/src/plugin/plugin.ts
---
**Value.** A plugin inside Tagma — a CRM, a trading desk, a tracker bridge, a game — an agent writes as a directory in the project and runs with no deploy and no Tagma change.

**How.** A directory in the project's `.tagma-plugins/<id>/` holding a plugin written against `@runlith/tagma/plugin`, whose `tagma-plugin build` writes `tagma-plugin.json` and the bundled `dist/process.js`. The agent installs it from that folder (`install_plugin`, read in place), runs or stops it per project or in every project (`enable_plugin`), removes it (`uninstall_plugin`), and reads its state (`read_plugins`, whose row carries the process). The Plugins screen lists it beside the other formats' plugins with its process state. The built-in `plugins` skill explains to an agent how to write, build and debug one.

**Behaviour.**
- The manifest carries the id, title, version, options, an optional process entry and contributions by points, each tool with its description and input schema. A plugin without a process is views and agents only.
- A manifest or a contribution its point rejects refuses the install with the reason; a point whose check needs a sibling — a tool the manifest does not name for Tagma, a view `views` does not name — shows as the plugin failing, with the reason.
- Contributions stand while any project enables the plugin, before its process ever runs: an agent sees its tools at once. The first call, tick, ending, notification answer, build step or view subscription starts the process, which goes to sleep after five quiet minutes; a resident plugin's process runs from its enabling.
- One process per machine serves all projects and is told, on every call, the projects where the plugin is enabled. Uninstalling stops it everywhere and drops its secrets; neither its folder nor its data is touched.
- A rebuild — a new manifest or entry module — or an option change restarts a running process once; editing `ui/` does not. A restart waits for started calls, new ones wait for the next process. A crashed process comes back on the next demand after an increasing delay, a resident one by itself. A bad manifest after an edit keeps the old declaration working.
- A process whose tool list differs from its manifest is refused with the difference named, and its tools are offered to no agent until it starts cleanly.
- The process runs on Tagma's own runtime with no package install and no `.env` loading; it gets the server address, its caller address, a data directory and its options in env, and calls those Tagma operations that are open to an outside caller.
- The process runs as the operator's OS user; installing names the module it runs for the operator's consent.

**Limits.** Views are HTML pages under `ui/`, served on the plugin's own origin.
