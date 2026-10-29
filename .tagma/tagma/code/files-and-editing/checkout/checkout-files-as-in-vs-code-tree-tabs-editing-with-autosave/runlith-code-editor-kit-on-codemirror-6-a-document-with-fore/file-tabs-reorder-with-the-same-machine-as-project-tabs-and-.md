---
id: 01a15054-a1dd-767c-a829-f6cd339811c8
title: File tabs reorder with the same machine as project tabs and the dock
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15052-f578-7d19-a86e-9083ba49b157",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/TabStrip.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Reorder.svelte.ts
---
Checkout tabs reorder with the same machine as project tabs and the dock. Checkout tabs used native HTML5 drag-and-drop: a browser ghost, a frame over the target, no neighbor animation. Project tabs and the dock do it with a pointer through `Reorder` — the tab follows the cursor, neighbors part with a FLIP animation. `Reorder` moves out of `features/projects` into `lib/shared`, generalized by key and order, and the project line, the dock, and file tabs take it.

Proof: app typecheck, `features/projects` and `features/checkout/files` tests green.
