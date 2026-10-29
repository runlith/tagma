---
id: 01a15528-266b-7dc1-a3a2-ccf804e057b3
title: The thread header shows one pill of working children and a pop-up with them instead of a Team button, chips, and '+N'
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15089-14c2-7aa1-9eee-2df7929f6822",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9286739b512c
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/team.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThisThread.svelte
---
By the operator's decision (artifact "Working agents in the header", `http://localhost:5634/a/a32cb6759bda`). The "N working" pill stands while any direct child has a run going (working, stalled, awaiting) and leaves when all finish. The pop-up holds only those children, ordered by run start time, as thread-list lines: life mark, name, model, time, with the current step on the second line. The last line, "All N in the thread list", opens the sidebar and expands the thread's subtree with the finished ones. Chips with names, "+N", and Waiting/Failed/Done groups leave; with them goes the defect where a stuck child fell into no group.

Start: `apps/tagma/app/src/lib/features/threads/TeamButton.svelte`, `team.ts`. Proof: app typecheck, order and selection test in `team.test.ts`.
