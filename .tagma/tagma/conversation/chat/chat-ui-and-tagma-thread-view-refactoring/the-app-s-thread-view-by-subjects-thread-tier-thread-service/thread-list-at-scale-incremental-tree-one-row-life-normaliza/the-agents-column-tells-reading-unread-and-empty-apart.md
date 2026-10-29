---
id: 01a15b5e-88be-7366-9ba7-0f8cfb894faa
title: The agents column tells "reading", "unread" and "empty" apart
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b51-86f5-7d20-b394-85abf4331f39",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ListReading.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ListRefused.svelte
---
Before the first `list` frame from `threads.subscribe`, the column showed the empty-project invitation: the condition looked at the empty tree, not at `ThreadList.roots === null`. A subscription refusal left the column "empty" forever. Now before the frame — row skeletons, on refusal — the reason and a subscription retry, the invitation only on a rootless server answer.
