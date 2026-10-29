---
id: 01a18330-e17f-7d9c-8b28-1f677e08c90b
title: A graph row carries a square state mark only with a lifecycle, its own tag icon, no date outside work, and a container's weight and count
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18331-30b6-76e9-b50d-e71d64c28093",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18319-42dc-76d5-8f38-ae98aa192705
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/features/graph/sidebar
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/BlockRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/TagIcon.svelte
---
Part 6 of [[aa192705]], the row alone: `outline/BlockRow.svelte`, `TagIcon.svelte`, the sidebar rows. An icon for every shipped tag (an explanation glyph on `Glyph`, not the `Hash` fallback), the state mark square and drawn only on blocks with a lifecycle, the date only on work, a container shown with weight and its child count, one line with a fade in navigation lists. The pages and the sidebar's places wait for the `tagma` pass.