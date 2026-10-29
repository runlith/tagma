---
id: 01a14bc5-0df5-77c8-b1a2-694dcd9bb77d
title: "Windows, CLI, and agents read the project's whole graph: outline, edges, links, roots, trash"
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692e4ad9de5e
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69419b982509
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694a1fdbaf7b
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/Feed.ts
    symbol: GraphFeed
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/outline.ts
    symbol: OUTLINE_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/registry.ts
    symbol: REGISTRY_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/outline.ts
    symbol: OUTLINE_PAIRS
---
**Value.** App windows, CLI, and agents get the project's whole graph in one call (tree, edges, links, roots, trash), and windows then update through a live feed with no polling.

**How.** `read_tree`, `read_edges`, `read_refs`, `list_root_blocks`, `list_trash`, `read_path_exists`; the `tagma edges` and `tagma trash` CLIs.

**Behaviour.**
- Answers arrive for the whole project, with no pages. Outline, map, and the Knowledge column build from them.
- A live feed brings changed blocks with affected edges, links, frontier, and trash. When the dictionary changes, the window rereads everything.
- A path check answers whether a file exists in the checkout the graph is measured against; the app terminal uses it to check file links.

**Limits.** Path checking works only with file graph storage and never follows symlinks outside the checkout.
