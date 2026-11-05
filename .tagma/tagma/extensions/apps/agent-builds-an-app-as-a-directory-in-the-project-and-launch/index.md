---
id: 01a14c08-8336-7b3c-965a-b09415a61526
title: "Agent builds an app as a directory in the project and launches it with no deploy: one process per machine, per-project enabling"
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
    ref: apps/tagma/app/src/lib/features/plugin-views/SettingsSection.svelte
  - kind: file
    ref: apps/tagma/server/src/plugin-host/contract/wire/manifest.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/discovery.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/doctrine/apps.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/generation.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/installs.ts
  - kind: file
    ref: apps/tagma/server/src/plugin-host/supervisor.ts
---
**Value.** An app inside Tagma — a CRM, a trading desk, a tracker bridge — an agent writes as a directory in the project and launches with no deploy and no Tagma change.

**How.** An `<id>/` directory with `tagma-app.json` in the project's `.tagma-apps/` or in the server data directory's `apps/` (personal). The agent reads the manifest schema (`read_app_schema`), installs the app (`install_app`), shows or hides it in the project (`enable_app`), deletes it (`uninstall_app`), and reads state (`read_apps`). The built-in `apps` skill explains to an agent how to write, connect, and debug an app.

**Behaviour.**
- The manifest carries the id, title, an optional process — any program speaking MCP over stdio — and contributions by points. An app without a process is views only.
- One process per machine serves all projects; installing is a machine record, enabling is per-project. Deleting drops the enabling in all projects and touches neither the app data nor its directory.
- Editing the app's files restarts the process; `ui/`, dependencies, `.git`, and what its `.gitignore` names do not. A restart waits for started calls, new ones wait for the next process; a crashed process restarts with an increasing delay. A bad manifest after an edit keeps the old process working.
- A directory whose manifest is not named `tagma-app.json` is no app: its row reads refused with the missing file, and no process starts.
- The process gets the server address, its caller address, and a data directory in env, and calls those Tagma operations that are open to an outside caller: thread births and turns, reading them, notifications, pins, the browser.
- The process runs as the operator's OS user, with no further questions.

**Limits.** The Tagma window has no apps screen: no state list, no install, no enabling. The operator installs an app through an agent or `tagma op`, while Settings → Apps shows the `apps.installed` and `apps.enabled` records as raw JSON, because the shared managed-key element looks for a `name` field on the row, and an app record has none. A fallen or refused app is visible only in `read_apps`.
