---
id: 01a12d2d-d758-71a8-96a8-58ef6cdd67c3
title: An external adapter receives host modules from the server copy, loads only with --no-install, and each version lives in its own directory
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c46-ab9c-7595-ace5-ac3d08bdb7be
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/hostModules.ts
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/external.ts
  - kind: file
    ref: apps/tagma/server/src/providers/adapters/installs.ts
  - kind: file
    ref: apps/tagma/server/src/providers/registry.ts
---
An external adapter runs inside the server process and receives `effect`, the contract's `@runlith/llm` modules, `@runlith/held/Held`, `@runlith/tagma/adapter/provider` and built-in adapters' models and profiles from the server copy: `Bun.plugin` serves them as virtual modules from the composition list (`hostModules.ts`). So `instanceof LLMError`, Schema classes and the global `Held` registry are the same objects for adapter and core. The list is the contract surface: a module outside it never reaches the adapter.

Without `--no-install`, Bun would silently resolve an off-list import through auto-install from npm, and the adapter would end up with a second copy of effect. So the loader itself refuses external adapters when the flag is missing from `process.execArgv`, while every server launch point (`SERVE_FLAGS`: launcher, `ensureServer`, succession, `tagma:try`, desktop) passes it; with the flag such an import is a loud refusal of that adapter.

Host modules load once, sequentially, at the first external-adapter load: parallel loading of built-in adapters' module cycle catches a TDZ. A host module that failed to load reports its failure only to the adapter importing it.

ESM never unloads, so each version installs into its own `~/.tagma/adapters/<id>@<version>` directory (reinstalling the same version adds a suffix), and the registry's `reload` imports it as a new module graph; the previous one stays in memory until restart. A run holds the catalog it started with (`forRun`/`releaseRun` by run id, released when the run settles), the new version serves from the next run; credentials, quota and sign-in read the current catalog at once. At server startup, everything in the machine directory not named current by `installed.json` is removed.
