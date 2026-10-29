---
id: 01a118b8-939c-7442-a19e-c93b8ae98ad9
title: The worktree name in a thread row yields to a coloured dot with a hint when space is short; the worktree mark is round everywhere
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a116c3-516d-70a8-874e-1b9e71520d43",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11792-a345-78e4-8aa7-842f55333c0f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/worktrees/PlaceBadge.svelte
---
After [[55333c0f]] the worktree badge in a thread row always showed the name's tail (`…manager` instead of `file-manager`), even when there was room. The operator's decision: while the level's rows have room, the badge shows the whole name; at its own squeeze step the name goes away, leaving only the coloured dot, whose name is visible in the hover hint. The badge never disappears. The "name or dot" choice depends only on the column width: at one width all badges either show names or dots and never switch as thread contents change. Separately: the `xs`-size worktree colour mark was square, the rest rounded — now rounded the same everywhere.

Where: `apps/tagma/app/src/lib/features/threads/worktrees/PlaceBadge.svelte`, `squeeze.svelte.ts`, `apps/tagma/app/src/lib/features/worktrees/WorktreeSwatch.svelte`.

Done when: typecheck is clean; in a wide column the name shows whole, in a narrow one a dot with a hint, the mark round.
