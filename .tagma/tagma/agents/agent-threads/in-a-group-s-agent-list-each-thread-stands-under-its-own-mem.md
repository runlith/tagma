---
id: 01a18dc8-c6bc-72fe-bf90-caa2f9a7421d
title: In a group's agent list each thread stands under its own member's places, members' places in group order
ord: 32
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a127d5-9d87-76ae-8d72-a74578ba2951
  - kind: relates
    to: 01a18da7-d528-7f21-b218-68e52e540ecf
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/worktreeGroups.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/TilePlaces.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/PlacesHold.svelte
---
A thread's place exists only among its home's checkouts, and each project's places are a live subscription of that project's scope (`Worktrees`, project tier). Read through the window's own project, another member's thread found no place of its own and fell into that project's main checkout. So the agent column holds the project scope of every other member of its tile (`PlacesHold`, through `holdProject`) and keeps their places beside the window's own (`TilePlaces`). Grouping takes the members in group order, and each member's places become their own groups. A row is placed by the places of its own home, falling back to the first member's only for a home outside the tile. A non-first member's place header carries its member mark under the rule rows follow (`Workspace.markOf`), so neither the order nor the marks depend on where the window stands.

Whatever the column draws about a place is read from the row's own member, and so is what it does with one: the shelf badge, "Move to a worktree", worktrees being made, and the header's acts, which run inside that member's held scope (`HomeHold`). Their answers are presented from that scope too: the column's hold mounts the member's finish dialog, since the top bar presents only the window's own project's, and the outcomes of a member's departed worktrees are drawn under the list per member. A home outside the tile has no places here, so nothing about a place is drawn for its rows. With a single project the tile has one member, and the view is the project's own.
