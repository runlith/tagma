---
id: 01a194a8-e6d9-7496-babf-e99df53a68ef
title: The client draws a gated item only by the `Access` answer and never removes its declaration
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/wire/access.ts
  - kind: file
    ref: apps/tagma/app/src/lib/wire/Door.ts
  - kind: file
    ref: packages/layer/src/svelte/PointView.svelte
---
The server decides whether an act is allowed. The client reads the same answer only to draw, and judges it the way the server does, by the use its point declares: `gateOf(access, use)`. A creation field, a settings contribution or a composer part is a write; a feed part, a tab or a "+" offer is a read. An item under a right shows its own payload when the answer admits that use (`full`, or `read` for a read), its `offer` when the answer is short, and nothing while the answer is unknown or no filler stands. So a window never offers an act the server would refuse. The use is the point's own: a gated point declares `draws: gatedBy(use)`, and `PointView` draws every item through `point.drawn`, so no place can forget to judge. `gatedBy` takes `Access` with `optional()` when the point is built: a filler that stands only under a condition flipping later is not seen by a point built before it. The right never removes the item from its point or registry, because the answer can arrive after a layout restore or a registry index has read the declarations, and removing the item there would sweep saved tabs or references that the next answer admits. A refusal carrying a `right` gets its `AccessHint` note and act where an operator act's refusal is formed: in `Door` and in `Live`'s calls. So every surface showing that `Told` shows the hint without knowing about rights. A subscription failure keeps the `right` for its reader.