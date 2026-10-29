---
id: 01a14c13-c481-7acc-8aa6-03d2b3b3a55f
title: "The worktree switcher in the window header picks where the window stands: graph, Git, agents, and the new thread and terminal place"
ord: 11
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-929587c73bc6
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ca64c5c6e8
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/WorktreeCard.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/WorktreeSwitcher.svelte
---
**Value.** The operator moves between parallel project branches in two presses and sees where agents work.

**How.** The worktree button in the window header with search; the current worktree card; "All worktrees" at the bottom of the list opens the board — with several worktrees it's the board's main door.

**Behaviour.**
- The list: the main checkout, then active by movement, quiet ones collapsed; each with color, agent work, and the running act. Search runs over all worktree metadata and branches without a worktree; such a branch opens with "Create & go". Expensive facts are labeled with their freshness and requested only for visible rows, including after search and expanding the quiet.
- The window moves to the picked worktree, while the open thread stays in place; the tooltip names thread moving (A1).
- "Draft in a new worktree" makes a thread draft whose worktree is created with the first message, under a temporary name settable at once.
- The button shows how many of its worktree's agents wait and work, at any worktree count. With one worktree, a branch the graph looks at stands instead of the diamond.

**Limits.** A worktree without a branch doesn't open. A missing worktree whose folder is gone isn't shown by the switcher: they're deleted on the board.
