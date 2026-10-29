---
id: 01a128f6-9a69-787a-895e-c1ce470cfcd9
title: "The worktrees board does not show that its live feed broke: rows stay as they were"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a128d3-c584-73f4-9b4d-c20485fdb582",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a128d3-dc02-75fe-b55d-26f89d510fba
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/BoardState.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/WorktreeBoard.svelte
---
When `worktrees.subscribe` ends in failure after the first `list` (for example, `present` or `distance` refuses while reading a tree), `Worktrees` in `BoardState.svelte.ts` records the cause in `unread` but keeps `rows` and `known = true`. `GitTab` still selects the board, and `WorktreeBoard.svelte` draws rows with no sign they are no longer live. Since the feed started sending the list before reading trees (9d510fba), such rows may still be unread: `uncommitted` and other facts in them are `null`, status idle. The live client does not resubscribe a fallen feed on the same connection (`Live.ts`, the `onFailure` branch).

Do: the board shows the feed failure and offers no actions on rows it no longer leads, or the feed is reopened. At the same time `FinishDialog.svelte` writes "could not be read" when `uncommitted === null`, though that is now also the ordinary "still reading" state.

Done when the feed failure after the first frame is visible on the board, as shown by a component test or a manual check on one's own instance.
