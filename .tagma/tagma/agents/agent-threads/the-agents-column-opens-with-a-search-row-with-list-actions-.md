---
id: 01a17361-f0b0-7237-af3d-8999d90eaf02
title: The agents column opens with a search row with list actions; the place's agent counter is one — at the branch button
ord: 27
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9286739b512c
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d2b3b3a55f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/WorktreeSwitcher.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ColumnHead.svelte
---
The column has no header of its own. The word "Agents" repeated the place mark on the rail. Its buttons act on this list, so they stand in the search row: the view only with several worktrees, "collapse all" only when there is something to collapse, "new thread". Agent library is agent definitions, not an action on the list, so its button stands on the rail and in the palette.

The counter above the list showed the whole project's work, like the project badge in the dock and marks in the project tab. They diverged only at the edges: the column counted working children from other projects too, while the badge counts stuck threads. So there is one number of the place: the branch button counts waiting and working in its worktree at any worktree count. Had it shown the number only with several worktrees, a project with one worktree would stay with no counter: the dock and project tabs only appear from the second non-global project.

The field is called Search: text filters threads and searches their conversations, while a question is asked to Tagma in the palette, where text goes on Enter. There is no ⌘K hint in the field: that chord opens the palette and does not put the cursor in the field.
