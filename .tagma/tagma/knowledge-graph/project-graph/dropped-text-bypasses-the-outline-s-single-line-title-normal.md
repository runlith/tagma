---
id: 01a0cac2-00a5-75db-8cd4-c0a7554bf7c0
title: "Dropped text bypasses the outline's single-line title normalization: no drop handler"
ord: 4
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/OutlineRow.svelte
---
Outline titles are single-line by normalization: paste replaces newline runs with a space (`OutlineRow.svelte:133-137`, claimed by [[2cfd57cb]]). But no `onDrop`/`ondrop` handler exists anywhere under `outline/` — a drop into the editable takes the browser's default path and bypasses normalization, so a multi-line drop lands a multi-line title the invariant forbids.

Handle drop like paste (normalize on the drop path) or forbid it. Done when a multi-line drop cannot land a multi-line title, with a test pinning the drop path beside the paste one.