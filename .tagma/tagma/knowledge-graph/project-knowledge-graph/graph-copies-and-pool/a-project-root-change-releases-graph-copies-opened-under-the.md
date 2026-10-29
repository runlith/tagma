---
id: 01a179c5-d755-7407-86c3-ab47a30a540b
title: A project root change releases graph copies opened under the old registration before the new place is first opened
ord: 11
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15149-31c7-7e1f-b8f9-42ab3e562c8b
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/pool.ts
    symbol: makeGraphPool
---
A graph copy remembers the registration it was opened under: the project root, the repository key, and the storage. After `set_project_root` (or returning the project to a new place) the new place of a stealth project gets a tree with another name, and opening moves the same graph worktree branch there (`git worktree move`). If the old copy is still alive, its watcher sees its tree disappear, and its topology returns the worktree to the old name — the new place's opening reads a tree that is pulled from under it and refuses with `BlockTreeUnreadable … ENOENT`, although the root-change act already completed.

So an opening that finds the project's copies or still-running openings from another registration first releases all the project's copies under the same "changing" mark as the storage move: it waits for already started openings, and new ones wait for its removal. The opening admission checks the registration against the opening record in the same synchronous step: otherwise an old-place opening that has not published its copy yet would miss a new-place opening, and both would move the same tree. Holds do not save a copy — it stands on a place the project no longer has. The registration change itself does not close copies: the project's first opening after it does, and before it the old copy moves nothing.
