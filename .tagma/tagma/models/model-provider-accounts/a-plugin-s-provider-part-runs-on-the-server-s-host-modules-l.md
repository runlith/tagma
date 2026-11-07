---
id: 01a12d2d-d758-71a8-96a8-58ef6cdd67c3
title: A plugin's provider part runs on the server's host modules, loads only with --no-install, and each revision lives in its own directory
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c46-ab9c-7595-ace5-ac3d08bdb7be
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/hostModules.ts
  - kind: file
    ref: apps/tagma/server/src/providers/registry.ts
  - kind: file
    ref: packages/tagma/src/adapter/loader.ts
  - kind: file
    ref: apps/tagma/server/src/composition/adapterSources.ts
---
A provider part runs inside the server process and receives `effect`, the contract's `@runlith/llm` modules, the `@runlith/speech` wire and protocol modules, `@runlith/held/Held`, `@runlith/tagma/adapter/*` and built-in adapters' models and profiles from the server copy: `importProviders` (`@runlith/tagma/adapter/loader`) serves them through `Bun.plugin` as virtual modules from the composition list (`hostModules.generated.ts`, written from every workspace package's `tagma.host`). So `instanceof LLMError`, Schema classes and the global `Held` registry are the same objects for a plugin's providers and the core. The list is the contract surface: the SDK build leaves exactly these as imports and bundles the rest, and a module outside it never reaches the part.

Without `--no-install`, Bun would silently resolve an off-list import through auto-install from npm, and the part would end up with a second copy of effect. So the loader refuses when the flag is missing from `process.execArgv`, while every server launch point (`SERVE_FLAGS`: launcher, `ensureServer`, succession, `tagma:try`, desktop) passes it; with the flag such an import is a loud refusal of that part.

Host modules load once, sequentially, at the first import: parallel loading of the built-in adapters' module cycle catches a TDZ. A host module that failed to load reports its failure only to the part importing it.

ESM never unloads, so each build of a plugin's part is copied into its own `<data>/plugin-revisions/<id>/<revision>/` and imported from there as a new module graph; the previous one stays in memory until restart. A revision is the digest of the part's files and the manifest fields the loader reads, so a rebuild that changes only the plugin's process or views imports nothing new. Inside the server the registry and speech import a revision directory through `importProviders`, so it is one module instance for both; a CLI's hook process is a process of its own and imports its own copy of the same directory. A run holds the catalog it started with (`forRun`/`releaseRun` by run id, released when the run settles), the new revision serves from the next run; credentials, quota and sign-in read the current catalog at once.
