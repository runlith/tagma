---
id: 01a18d75-6f3d-7761-b92d-641bcf03a4df
title: The window frame follows the open seat's place, so an act that aims elsewhere while a draft is open sets that draft's place
ord: 29
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18d49-8332-708f-85d5-3198619987f6
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/FrameFollow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/WorktreeSwitcher.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/acts.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/birth/BirthPlace.svelte.ts
---
While a thread slot is the host on the chat surface, `FrameFollow` aims the window frame (the address's `branch`) at the place of that slot's open seat (`ThreadSlot.place`). For a thread that is where the thread works. For the draft it is the draft's own place, except a new worktree, which has no folder yet and so leaves the frame where it is. The main checkout clears the address's `branch` even when its HEAD is detached. The effect runs again on every change of the address, so a frame move that leaves the seat's place unchanged is undone at once.

So an act that aims the window at a place while a draft is open writes the draft's place and lets the frame follow. The header switcher picks into the open draft. Every act that starts the project page's draft goes through `PageDraft`: the palette's New thread, "New agent here", and leaving an open thread from the switcher. `PageDraft` writes the place onto the record of the page's unborn draft (`unbornKey`), focuses the main seat and navigates. The act may start from Git or the board, before the page's slot exists, and the draft record outlives the slot. The focus is part of the act because the chat route clears a side pane's focus only when its thread id changes. A side thread left as the host would pull the frame back to its own place.

The draft used to take its place from the frame instead. Every thread opened re-aims the frame, so a new draft started in the worktree of the last thread opened.
