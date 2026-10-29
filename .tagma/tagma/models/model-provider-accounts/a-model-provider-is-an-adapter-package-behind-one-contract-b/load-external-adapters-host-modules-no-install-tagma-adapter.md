---
id: 01a12c46-ab9c-7595-ace5-ac3d08bdb7be
title: "Load external adapters: host modules, --no-install, tagma adapter add/update/remove, versions in their own directories"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c47-00db-7c9c-bac5-59ed12329bd1",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12c24-69a2-7f74-a6cf-a29052b10a62
  - kind: waits-on
    to: 01a12c46-ab9c-7595-ace5-ac3c51d6a7bf
---
Sections "Adapter contract" (host modules, `--no-install`) and "Delivery and installation" (externals) of the spec [[52b10a62]]. `Bun.plugin` with virtual host modules; the loader refuses without `--no-install` (`process.execArgv`), all four server launch points pass the flag; install from npm/GitHub/path with `--omit=peer` and a machine record; each version in its own `~/.tagma/adapters/<id>@<version>/`, the run holds its version, earlier ones are cleaned at startup; the loader also reads `<root>/adapters/`. Done: the spec checks for external adapters in release, off-list imports and no-restart updates pass.

Made in commit 3864fbf835, landed past the gate on the operator's word: the [[50520d64|platforms rule]] refused on the loader's non-literal `import()`. The rule gained a `loaders` parameter (file and reason) in the inspection sources; after the operator restarts the server it is set through `enforce_rule` for `apps/tagma/server/src/providers/adapters/external.ts`. Not proven: install from npm and GitHub, loading from `<root>/adapters`, the CLI and operations in full, the release build.
