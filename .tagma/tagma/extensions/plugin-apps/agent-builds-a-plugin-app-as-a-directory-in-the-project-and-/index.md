---
id: 01a14c08-8336-7b3c-965a-b09415a61526
title: "Agent builds a plugin app as a directory in the project and launches it with no deploy: one process per machine, per-project enabling"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928acad90fdf
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/plugins/SettingsSection.svelte
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/manifest.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/discovery.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/doctrine/plugins.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/generation.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/installs.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/supervisor.ts
---
**Value.** An app inside Tagma — a CRM, a trading desk, a tracker bridge — an agent writes as a directory in the project and launches with no deploy and no Tagma change.

**How.** An `<id>/` directory with `plugin.json` in the project's `.plugins` or in the server data directory's `plugins` (personal). The agent reads the manifest schema (`read_plugin_schema`), installs the plugin (`install_plugin`), shows or hides it in the project (`enable_plugin`), deletes it (`uninstall_plugin`), and reads state (`read_plugins`). The built-in `plugins` skill explains to an agent how to write, connect, and debug a plugin.

**Behaviour.**
- The manifest carries the id, title, an optional process — any program speaking MCP over stdio — and contributions by points. A plugin without a process is views only.
- One process per machine serves all projects; installing is a machine record, enabling is per-project. Deleting drops the enabling in all projects and touches neither the plugin data nor its directory.
- Editing the plugin's files restarts the process; `ui/`, dependencies, `.git`, and what its `.gitignore` names do not. A restart waits for started calls, new ones wait for the next process; a crashed process restarts with an increasing delay. A bad manifest after an edit keeps the old process working.
- The process gets the server address, its caller address, and a data directory in env, and calls those Tagma operations that are open to an outside caller: thread births and turns, reading them, notifications, pins, the browser.
- The process runs as the operator's OS user, with no further questions.

**Limits.** The app has no plugins screen: no state list, no install, no enabling. The operator installs a plugin through an agent or `tagma op`, while Settings → Plugins shows the `plugins.installed` and `plugins.enabled` records as raw JSON, because the shared managed-key element looks for a `name` field on the row, and a plugin record has none. A fallen or rejected plugin is visible only in `read_plugins`.
