---
id: 01a17506-9bc9-7411-9bbc-82415297544d
title: Lower modules declare points that features fill from their own layers; registries index the point's current items, and the Addresses service builds addresses
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/surface.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/actions.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/address.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Addresses.ts
---
A list many features fill is a point its lower owner declares, and each feature contributes from its own `layer.ts`. Surfaces (`Surfaces`, workspace), section columns (`Columns`, workspace), palette actions (`PaletteActions`, workspace), tab kinds (`Panes`, shared panes), link kinds and link menu items (`LinkKinds`, `LinkMenuItems`, opening), settings sections and their contributions (`SettingSections`, `SectionContributions`, settings). The owner stands below every feature that contributes to it. If it loaded their files itself, every importer of addresses would pull all features up the module order. A root outside the core merges its own feature layer beside them, and its items join the same points.

Each registry (`SurfaceRegistry`, `ColumnRegistry`, `ActionRegistry`, `PaneRegistry`, `LinkRegistry`, `SectionRegistry`) is a service over its point. It reads the point's current items when asked and rebuilds its index only when the items array changes, never snapshotting them at build. A contribution may join after the registry was built: members are eager and build in manifest order, or later under a condition or from a chunk. Invariants between items are claims the point refuses at admission: a route, a former name, the home surface, a setting key held by a section, a tab kind's link. A reference to something this build lacks degrades instead of refusing: a column, a parent surface, or a section a contribution names. A core alone, or an extra root without the feature that declares it, still opens. `SurfaceRegistry` also keeps app sections registered on the fly (`register`), apart from the point. They are not portable and answer nested routes.

Addresses that need the registry are built by the `Addresses` service (from `Router` and `SurfaceRegistry`). Components take it via `.use()`, services by injection, and helpers outside the graph (`markdown.ts`, `blockRefView`, `commitAnchors`) receive it as a parameter. `address.ts` keeps pure functions that need no registry: project, branch, diff and route parameters from `Router`, and diff-range parsing. A test that needs the core's surfaces or links takes them through composition test doors (`testSurfaces`, `testAddresses`, `testAddressing`, `testLinks` in `app/testing.ts`), or builds a registry over `makePoint` with the declarations it needs. Workspace declares the "Go to …" actions as a function of the app, because their list depends on the registry.
