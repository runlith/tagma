---
id: 01a127f1-103d-7b70-b870-6b3394f1d087
title: The detachedFrom crumb carries the former parent's home, which the list never saw
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127e1-03e3-7450-bc68-604d9047474c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a127df-68ce-7e9a-94ba-389374c0f03d
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/list.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/snapshot.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/state.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/threads/Header.svelte
    symbol: detachedFrom
---
`ThreadListRow.detachedFrom` and the Header keep only the former parent's id: after detaching a child from B off a parent in A, B's list does not contain it, and `openAtHome` picks B through `homeOf`. Deliver the former parent's address with its home from the record owner and use it in the crumb, keeping behaviour on a deleted parent. Done: navigating after a cross-project detach opens the existing former parent in A with no list dependency, with a state unit test and a narrow Svelte check.
