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
- what belongs to the slot's place rather than the thread — worktrees and unparsed checkout rows — is not shown on a foreign-home row: moving into A's worktree and reading rows through project A would be refused by the server.

While the project registry does not know the home's name (project registered after load), the link stays without an href instead of leading to A: `Workspace.find` re-reads the registry once per unknown id.
