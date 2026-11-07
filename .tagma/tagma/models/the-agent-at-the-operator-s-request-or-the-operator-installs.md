---
id: 01a14c08-22b6-75de-88f8-5bfa3af9eb3d
title: The agent, at the operator's request, or the operator installs a provider as a plugin from a folder, git, npm or a marketplace, and updates it without restarting the server
ord: 13
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bfbf3189649
  - kind: relates
    to: 01a14c08-22b6-75de-88f8-5bfc99c7336a
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/hostModules.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/revisions.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/sources.ts
  - kind: file
    ref: apps/tagma/server/src/composition/adapterSources.ts
  - kind: file
    ref: apps/tagma/server/src/plugins/contract/wire/operations.ts
---
**Value.** A provider not built into Tagma — a model API, a CLI agent, a speech service — is connected with one request to an agent or one add on the Plugins screen, and a new version needs no server restart and breaks no running thread.

**How.** A plugin whose definition names a providers module; `install_plugin` from its folder, a git URL, an npm package (`npm:<name>[@range]`, from the registry the machine's npm configuration names) or a marketplace entry; the Plugins screen's add field, which the Providers screen's "Add a provider" opens. `enable_plugin {scope: machine}` turns its providers off on the machine and on again.

**Behaviour.** The provider part runs in the server process on Tagma's own copies of the contract modules, so a server without `--no-install` refuses to load it. Each build is copied into a revision of its own and imported from there: a running run, ask, CLI session or recognition finishes on the revision it started with, the next one takes the new revision, and login, credentials and quota read it at once; a revision nothing holds any more is removed. A part that fails to import, or declares a provider id another part holds, leaves every other provider standing and reads broken on its plugin's card with the reason. The providers Tagma ships stand beside it as built-in plugins.

**Limits.** A provider part depends only on Tagma's host modules and what its build bundles, not on another plugin. A revision stays in memory until the server restarts. The part has no process of its own: its synchronous work stops the whole server, and keeping it from doing so is the author's duty.
