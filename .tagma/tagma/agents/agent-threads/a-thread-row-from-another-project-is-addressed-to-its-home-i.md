---
id: 01a127d5-9d87-76ae-8d72-a74578ba2951
title: "A thread row from another project is addressed to its home in the list: feed, acts and links go with its projectId"
ord: 24
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a127b8-b649-75e5-8006-ef59c7eb9c87
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/List.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Peek.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Row.svelte
---
Project A's list also holds foreign-home rows: a child born in B stands under its A parent, while `ThreadListRow.projectId` is its home. The server accepts an act over a thread only with its home's project (otherwise `ThreadRefused`), and slot A does not hold B's feed, so everything the app does with such a row is addressed to its home:

- the feed opens by navigating to the home's project (`shell.openThread(…, 'main')` with `row.projectId`, the row href and `[[thread]]` links — with the home project's name), while "beside" (⌥-click, menu item) opens in the current project's side panel, which holds the home project and addresses everything to it;
- answers, continuation, stop, compaction from peek and menus go with `row.projectId`; list acts by id (rename, archive, pin, detach, delete) take the home from `ThreadList.homeOf`, which remembers the row's home even after it left the window — otherwise detaching's Undo would address A;
- a row's worktree is read from its home's places, never the slot's: moving into A's worktree would be refused by the server. The column hands each row its home's places when the home is a member of its tile ([[f9a7421d]]), so the peek, "Move to worktree" and "Move to project" work for any member's row, and a home outside the tile gets none. Unparsed checkout rows are read through the slot's project, so they stay hidden on a foreign-home row.

In a group's list every member's row is addressed to its home the same way, and opening one navigates to its home member; the agent column stands on the dock tile (the group), so that navigation keeps the list, its folders and scroll, and only the crumb with Files, Git and terminals moves. A row's project mark follows the group's order — every home but the first member carries it, wherever the window stands — while outside a group it marks a home other than the window's project (`Workspace.markOf`); the peek names the row's project under the same rule. A row of a member holds its home's project scope (`HomeHold`), so what it reads per project — its commands — is its home's. Its peek, the one part of a row that reads the graph (block references and commit links), stands in its home's graph as well (`holdGraphOf`): the window's own graph when the home is the window's project, else the copy a visit of the home opens, which recent visits already keep warm. A held project scope has no graph under it, and a graph-tier read from it is refused rather than answered from the window's graph.

While the project registry does not know the home's name (project registered after load), the link stays without an href instead of leading to A: `Workspace.find` re-reads the registry once per unknown id.
