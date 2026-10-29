---
id: 01a14bc5-0df5-77c8-b1a2-694a1fdbaf7b
title: "Spatial map draws the project graph on one canvas: tree, edges, and links"
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692dbb2a8aea
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692e4ad9de5e
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6949e55dee89
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/spatial/graphsim.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/spatial/GraphView.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/spatial/NodeCard.svelte
  - kind: file
    ref: apps/tagma/app/src/routes/[project]/graph/[[id]]/+page.svelte
---
**Value.** The operator sees the knowledge structure and links between blocks on one canvas, which a list never gives: what depends on what, what references what, where work piled up.

**How.** The project or subtree map screen; opened from the block menu and from the Knowledge column.

**Behaviour.**
- The canvas shows the tree, typed edges each in its color, and references as dashed lines. Resting blocks are paler.
- Modules, specs, tasks, ideas, and rules get their own shape and color. The legend names only those of these tags that the project declared.
- Clicking a node opens a card with status and turns. Nodes can be dragged, zoomed, and focused to a subtree; a tag and state filter rebuilds the camera.

**Limits.** Node positions live while the screen is open and are not kept between visits.
