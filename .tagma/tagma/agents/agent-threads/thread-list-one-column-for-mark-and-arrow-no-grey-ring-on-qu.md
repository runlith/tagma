---
id: 01a15b27-bf3a-75e8-bd84-9c8122741512
title: "Thread list: one column for mark and arrow, no grey ring on quiet threads"
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ac1-2b9a-7fc6-b993-3b1f606e8186",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Life.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Row.svelte
---
The operator's decision on the mockup http://localhost:5634/a/be17ee7a1db4 (“revert if disliked”).

- A thread row keeps one 14 px column before the title, not two. It holds the state mark. A thread with children and no mark of its own shows an arrow there, always visible and colored by the command. On hover over a thread with children the arrow sits over the mark. The title starts at 26 px instead of 46.
- A quiet thread draws no mark; the space stays reserved.
- A collapsed parent always shows what is inside: a colored count when someone works, waits, or failed, otherwise a muted hidden count.
- Collapse rows, “agents in worktree”, and folders align to the same column. A folder has no arrow; openness shows in the folder icon.
