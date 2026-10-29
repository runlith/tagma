---
id: 01a1365f-aa4f-7686-b9dc-569ce0eee946
title: Worktree deletion releases all observations of its root before removing files, so the FSEvents stream never rereads neighboring checkouts
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a136b4-0543-7cd5-a38e-72a7e2439d30",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13620-124c-75b1-8c9b-9ccc2dbd69ab
sources:
  - kind: file
    ref: apps/tagma/server/src/worktrees/retirement/delete.ts
---
The operator's performance thread measured on October 13: two `delete_worktree` calls on optional-fields caused about 300 full status reads (~1.5 s each) across 25 checkouts of three repositories, on `refs`/`tree`, though refs never changed.

The mechanism was confirmed by experiment on this machine (Bun, macOS, one sample each): Bun holds all `fs.watch` on a single FSEvents stream and restarts it on every observer open and close. When a mass deletion runs in an observed directory at that moment, the stream loses events and the remaining observers get phantom `change` on their roots and `refs`. In an unobserved directory there are no phantoms. Scripts live in `/var/folders/87/cmcr9wbs5yqcbthnzgqp7lh80000gn/T/fsevents-probe/`.

To do: before `git worktree remove`, deletion releases all observations of its root — checkout rows, head watch, documents — so none reopens before deletion ends.

Done when deleting a large worktree no longer rereads other checkouts (measured the same way).
