---
id: 01a17506-9bc9-7411-9bbc-82415297544d
title: Composition gathers feature contributions into lower-module registries and lays them as ports; the Addresses service builds addresses
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/declaredSurfaces.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/actions.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/address.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Addresses.ts
---
A feature declares its surfaces at home (`features/*/surfaces.ts`); composition gathers them (`app/declaredSurfaces.ts`), and `workspace` receives the finished registry through the `SurfaceRegistry` port, which composition fills with its own instance per app. `workspace` stands below all the features whose surfaces it knows: if it loaded their files itself, every importer of addresses would pull all features up the module order, and the cycle would hide in a global, past the import check. One instance per app, not per module, because the registry also holds app sections registered on the fly.

Addresses that need the registry are built by the `Addresses` service (from `Router` and `SurfaceRegistry`); components take it via `.use()`, services by injection, and helpers outside the graph (`markdown.ts`, `blockRefView`, `commitAnchors`) receive it as a parameter. `address.ts` keeps pure functions that need no registry: project, branch, diff and route parameters from `Router`, and diff-range parsing. A test that needs a real registry takes it through composition test doors (`testSurfaces`, `testAddresses`, `testAddressing` in `app/testing.ts`) or builds a registry from the needed declarations.

Contributions to other lower modules work the same way: tab kinds (`app/declaredPanes.ts` → `PaneRegistry` port), settings sections (`app/declaredSections.ts` → `SectionRegistry` port) and link kinds (`app/opening/declaredLinks.ts` → `LinkRegistry`). Composition likewise gathers section columns (`app/declaredColumns.ts` → chrome `ColumnRegistry`, built from `SurfaceRegistry`) and palette actions (`app/declaredActions.ts` → chrome `ActionRegistry` port, which `CommandPalette` takes via `.use()`); workspace declares the "Go to …" actions as a function of the app, because their list depends on the registry.
