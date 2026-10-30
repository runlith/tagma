---
id: 01a18d75-6fb5-7478-a3db-f0a3101a397a
title: A new-draft act puts the draft's place back to the main checkout; the slot's own returns to the draft keep it
ord: 30
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18d49-8332-708f-85d5-3198619987f6
sources:
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/ThreadSlot.svelte.ts
    symbol: ThreadSlot
---
`startDraft` is the operator's new-draft act: it writes the place it is given onto the slot's unborn draft (the main checkout unless the act names another) and shows that draft. `showDraft` covers the slot's own returns to the draft: archiving or deleting the open thread, and resending after a new worktree could not be made. These returns must keep the place the operator chose, because a retry that reset it would create the thread in main instead of the new worktree.
