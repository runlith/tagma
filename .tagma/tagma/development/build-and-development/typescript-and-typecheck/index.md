---
id: 01a0c708-ec59-71a4-97cf-8397af0405b2
title: TypeScript and typecheck
ord: 1
tags: ["module"]
fields:
  {
    "entries": [],
    "id": "@runlith/tsconfig",
    "kind": "kit"
  }
edges:
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/tsconfig
  - kind: file
    ref: patches/svelte-check@4.7.7.patch
---
All workspace projects build against one compiler base and run one typecheck command, `runlith-typecheck`. The command reads what manifests and configurations declare and checks the requested directory scope with the closure of its workspace dependencies, or under `--no-dependencies` the scope's packages alone, for a caller that only asks whether its own code compiles and runs several such checks itself; `--project` checks one configuration inside a workspace package with that package's checker: every TypeScript package is tsrs (the Rust port of TypeScript 7) on its own `tsconfig.json` with `--noEmit` and four checkers, one process at a time; a svelte package is svelte-check with the TypeScript 7 API; when checking a directory, a svelte package reachable from the closure is checked even outside the target directory. No project references and no generated configurations: a dependency imported from source is also checked in the consumer's program, so its error may repeat across packages. TypeScript 6 stays as the JS API for parsing tsconfig, sources, and transforming Svelte; Svelte diagnostics are counted by TypeScript 7 through a local Bun svelte-check patch. Native sync API needs Node, and tsx loads workspace configs with TypeScript sources. Svelte diagnostics keep the same one-line format and root paths as tsc; a broken or unfinished machine protocol never counts as a passed check, nor as found errors: a caller may record found errors as debt, so a svelte-check without its COMPLETED record and a tsrs exit other than 0, 1 or 2 end as their own failures. The tsrs version is pinned by a package dependency; the shared base declares `incremental`, so rechecking an unchanged package takes its `.tsbuildinfo`; tsrs writes it in place, without renaming, and drops a half-written or corrupted file, checking the package fully. Four checkers, not one per core: on a machine busy with other agents more threads check slower and hold more memory. The diagnostics reference is tsgo: tsrs orders checker history its own way by default, and an order-dependent error may appear under tsgo only in some layouts. Reading the workspace and the graph that follows from it belongs to the package; which packages exist, what each publishes, and what a failed check means for a change is left to manifests and the caller.
