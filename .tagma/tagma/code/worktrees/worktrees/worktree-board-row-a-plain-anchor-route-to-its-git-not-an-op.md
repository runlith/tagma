---
id: 01a17ebc-38ad-777a-ae00-05e137bfb138
title: "Worktree board row — a plain anchor route to its Git, not an Opening link view: a worktree has one place, and the row menu holds its acts"
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1744e-1362-7314-8205-5ff9ce1ef098
  - kind: relates
    to: 01a175bc-4df0-7e89-88ed-89730da203e8
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/BoardRow.svelte
---
A worktree has one place — the Git tab of its branch. There is no "nearby" place: the worktree tree in the holder's tab is forbidden by rule 19b8fd8a. A link view in `features/opening` would give exactly that full place, but a right-click on the row would open the view's menu, which holds no worktree acts. Repeating `FinishItems` as `LinkItems` items would mean writing a second implementation of the acts menu.

So the row is a plain anchor route to the worktree's Git with no link view. A click is a SvelteKit navigation. ⌘-click is caught by `Opening.listen` as a foreign route and navigates to the same address inside the app. Right-click and the menu key land in the row's handler: it stops the event before `Opening.listen` and opens `FinishItems` at the pointer. The "Open in Git" item in that menu carries the click combination. The link has no tooltip; a tooltip with hashes and HEAD stands only on the phrase with the previous fact ("checked 5h ago"), and that phrase itself takes the pointer.

If the worktree gains a second place, the row moves to a link view, and the `FinishItems` acts become its menu items.
