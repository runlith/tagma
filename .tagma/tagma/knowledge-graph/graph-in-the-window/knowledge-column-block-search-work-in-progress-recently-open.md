---
id: 01a14bc5-0df5-77c8-b1a2-6949e55dee89
title: "Knowledge column: block search, work in progress, recently opened, tree, and project views"
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/sidebar/Sidebar.svelte
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/sidebar/Sidebar.svelte.ts
    symbol: Sidebar
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/sidebar/SidebarTree.svelte.ts
    symbol: SidebarTree
---
**Value.** The project stays at hand: search, work in progress, recently opened, tree, and views stand in one column beside any knowledge screen.

**How.** The left column of the Knowledge surface, with an outline/map switch.

**Behaviour.**
- The search field finds project blocks. While it is empty, shelves show: work in progress with holders, recently opened blocks, project tree, and views.
- Collapsed shelves, opened branches, and column width are remembered in the browser.

**Limits.** The column tree hides the same resting blocks as outline.
