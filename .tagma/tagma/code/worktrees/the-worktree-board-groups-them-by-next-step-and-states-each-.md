---
id: 01a14c13-c481-7acc-8aa6-03ca64c5c6e8
title: The worktree board groups them by next step and states each one's state in one phrase
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c86c0ffc00
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03cbaf2058f5
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03cd5dfdb32c
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03ce4ddaf40d
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03cf5e92d5db
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d0ad0de7bf
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03d12f8bdbf8
sources:
  - kind: dir
    ref: apps/tagma/server/src/worktrees/listing
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/GitTab.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/board.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/BoardRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/FactStamp.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/MergeFact.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/Window.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/WorktreeBoard.svelte
  - kind: file
    ref: apps/tagma/server/src/landing/merge/check.ts
  - kind: symbol
    ref: apps/tagma/server/src/worktrees/contract/wire/operations/listing.ts
    symbol: LISTING_OPERATIONS
---
**Value.** The operator sees at a glance which parallel work waits for them, which runs, and which is due for removal, and takes the next step from the same row.

**How.** The Worktrees board opens only through an explicit door — "All worktrees" at the bottom of the worktree switcher or the icon in the Git header, both present with several worktrees; the Git button on the rail always opens the Git of the place picked in the header. Data is the `list_worktrees` operation and a live subscription; `check_worktree_merge` checks one worktree's merge.

**Behaviour.**
- main stands above the list as the base: its agents and uncommitted. It has no merge status: it merges into nothing.
- The rest group by next step: Needs you (agents wait for the operator, ready to merge, conflict, behind, checkout unreadable, merge stopped), Working (agents work, an act runs, merge waits for the base), Quiet, To clean up (merged, folder missing). An empty group doesn't draw; inside a group order follows last movement. While the pointer is over the list or the row menu open, order and groups don't change.
- The row state is one phrase of status, check, and distance: "Ready to merge 6 commits", "Conflicts with main", "4 behind main". A former fact is signed "checked 5h ago", hashes and HEAD in its tooltip. Agents are tiles of waiting and working. Next to the branch, dimmed, stands the worktree's oldest thread's title.
- A row links to its worktree's Git. The row button is one and only on a step: Merge… filled, Update and Delete outlined. The rest is the "…" menu and right-click. Clean up… stands in the To clean up header. A missing worktree is an empty dashed diamond, not red.
- Expensive facts update for working and visible rows; the subscription window follows scrolling, and a row off screen keeps the last read. An invisible idle row keeps the last read on the server or stays not yet taken. All worktree places and thread belonging are known outside the window.
- A saved merge check carries the branch and base tips it was taken at. One base movement doesn't recompute it: the current pair is taken by an explicit check or merge act. Conflicts only in graph files reconcile by block identity; a lagging format is first brought up in a temporary tree.
- Checkouts created past Tagma are visible, but Tagma doesn't finish them.

**Limits.** A row the window hasn't read yet stands in a group by its agents or in Quiet and moves when its facts arrive. The worktree has no task title: the server records no task on creation, `taskId` is always empty. An edit without HEAD or index change in an unobserved checkout shows on the next explicit re-read. A saved verdict doesn't replace checking the current pair before merging.
