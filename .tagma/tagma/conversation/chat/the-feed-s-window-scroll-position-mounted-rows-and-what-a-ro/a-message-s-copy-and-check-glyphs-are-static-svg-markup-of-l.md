---
id: 01a184fb-a2a2-7f90-b765-ec0ff4322211
title: A message's Copy and Check glyphs are static SVG markup of Lucide's shapes, not Lucide components
ord: 6
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18404-f6df-7814-bb9e-c815d7dbe006
sources:
  - kind: file
    ref: packages/chat-ui/src/entries/MessageMeta.svelte
---
Every user and assistant message mounts its toolbar, and Lucide's component builds an icon's children at run time — props spread, a derived stroke width, and an `{#each}` of `svelte:element` that inserts each `rect` and `path` into an SVG already in the document. At 4× CPU that was about 90% of the toolbar's mount cost and a measurable share of every row mount in a fling. Static markup compiles to one cloned template. The shapes and attributes are Lucide's `copy` and `check` at its default attributes, so the glyph is the same icon; a change of icon in this toolbar copies Lucide's shape the same way rather than importing the component.