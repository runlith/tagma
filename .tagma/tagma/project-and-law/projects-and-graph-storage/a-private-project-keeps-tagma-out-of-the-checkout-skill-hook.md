---
id: 01a14c14-a11c-7ce8-9d84-6322e28e8883
title: "A private project keeps Tagma out of the checkout: skill, hooks, and law stand at user level"
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6324da5f3f35
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632a7054398a
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-632bd215090b
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6331473f428a
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/cli/policy.ts
  - kind: file
    ref: apps/tagma/server/src/installation/cli/setup.ts
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/installs/skillInstall.ts
    symbol: installForUser
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/storage.ts
    symbol: PROJECT_SETTINGS
---
**Value.** Tagma can work in a foreign or shared repository without adding a single file to it: colleagues see neither an AGENTS.md section, nor skill, nor CLI settings.

**How.** The `--private` flag of `tagma project add`, `tagma project set <project> private true`, the `update_project` operation.

**Behaviour.**
- `tagma install` in a private project installs other CLIs' skill and hooks into the user directory and doesn't touch the repository; `tagma upgrade` refreshes that layer once for all private projects.
- The law lies in no checkout file: another CLI's session-start orientation carries the Tagma law section whole.
- Moving a private project to team storage writes the graph into the checkout and removes private; in operator review mode, they ask about it.

**Limits.** The commit gate and merge driver are installed anyway — into the checkout's git dir or its declared hooks directory, not into tracked files.
