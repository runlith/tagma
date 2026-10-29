---
id: 01a15eac-f9e0-7af9-a3c4-70d900707e38
title: "A project folder without git shows in the worktree list as “unreadable”: tell “not a repository” from a read failure"
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a160a4-f0aa-7f0b-93ed-48cb953888d3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15e61-d6ef-7bf3-b089-23b203c2c6d6
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
  - kind: file
    ref: apps/tagma/server/src/worktrees/listing/rowEntries.ts
---
Reading a non-git folder checkout ends in `GitRefused` ("not a git repository"); `workspace/checkouts/rows.ts` turns it into `stale: true`, and `worktrees/listing/rowEntries.ts` into `reading: failed`, `status: unread`; the switcher paints it red. For a folder project without git this is the normal state. The checkout-reading owner must tell "not a repository" from a read failure, the main line must show the folder with no branches and no error, and "New worktree" in it must be unavailable with a reason.
