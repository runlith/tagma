---
id: 01a18d8c-a1f0-714f-9e63-0746bb26d999
title: A thread list addressed by a group's own id covers every member; a member's id still lists only its own threads
ord: 141
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18d49-eba5-7e14-8517-20f9249b762f
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/select.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
---
The window's agent column subscribes to the group's own id, so its list, folders and scroll stay while the window moves between members. Every read of a list — `rootWindow`, `list` with its pinned selections, `families`, the archive selections — takes the homes it covers: the group's members for a group's id, the project itself for any other id. A root is a thread whose parent is not live in any of those homes, so a child born in one member under another member's thread stands under its parent in the group's list and as a root in its own project's list.

A row of a member reaches the listeners of its own project and of its group, never another member's own list. The membership is held in memory from `ProjectGroups.list()` and re-read on `ThreadFolders.regrouped`, after the folders followed the change; then the folders and the window of every listened list the change touched are sent again. A folder event goes to the folders' owner and every member's own list, since a member's rows are filed into the group's folders.
