---
id: 01a17ea8-df14-7102-a54a-82631c7362ac
title: The Git button opens the Git of the selected place, and the worktree board only via the "All worktrees" door
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17ea9-60f6-7e1d-bc58-7bc7f841fe49",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ca64c5c6e8
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d2b3b3a55f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/WorktreeSwitcher.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/GitTab.svelte
---
The Git button on the rail always opens the Git of the place selected in the header; the worktree board opens only through an explicit door. Right now `GitTab.svelte` puts up the board when there are several worktrees and the address has no `branch`, while `main` in the address is the absence of `branch` (`Worktrees.aimed`). So on main the Git button does not open Git, and its meaning changes with the worktree count: the agent made a second worktree — the screen is gone. The rule came from the closed spec [[b51edd1b]], written before the worktree switcher in the header, when "without a branch" meant "nothing selected".

The doors to the board are the button at the bottom of the worktree switcher (now Manage, rename to "All worktrees", like the icon in the Git column header) and that icon. The operator's decision follows the mockup http://localhost:5634/a/267daee0f9bf. Features [[64c5c6e8|board]] and [[b3b3a55f|switcher]] are fixed by the same change.
