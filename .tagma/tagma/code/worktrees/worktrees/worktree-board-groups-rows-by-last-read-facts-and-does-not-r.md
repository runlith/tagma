---
id: 01a17ebc-38ef-71cc-84f0-120124ac8bc0
title: Worktree board groups rows by last read facts and does not rearrange them while the pointer is over the list or a row menu is open
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/Window.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/WorktreeBoard.svelte
---
A row's group depends on expensive facts — merge status and distance from the base — and the server sends them only for the rows in the subscription window. If the window forgot a row that left the screen, it would fall into Quiet. Scrolling would move the list under the reader, and rows would jump between groups on every scroll. So `WorktreeWindow` keeps the last reading of a row while its place stands in the list.

A measurement is stored, not an activity verdict. Agents and a missing folder arrive as a live places feed for all rows, so the state is derived in the server's order: no folder first, then conflict, then waiting and working agents by place metadata, and only then the stored status. A stored "working" or "waiting" with no agents present means nothing, and the row stands in Quiet until fresh facts arrive. A row the window has not read yet stands the same way, by agents and folder.

Moving between groups is a signal, but it would carry a row from under the pointer. While the pointer is over the list or any row's menu is open, the board shows a snapshot of the layout while the rows' contents stay live. A row that appears during that time joins after the pointer leaves. The whole list freezes, not one row: shifting rows above would move the row under the pointer.
