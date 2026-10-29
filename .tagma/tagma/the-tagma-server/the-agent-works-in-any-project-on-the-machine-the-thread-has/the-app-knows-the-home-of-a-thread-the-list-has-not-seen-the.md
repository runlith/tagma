---
id: 01a127df-68ce-7e9a-94ba-389374c0f03d
title: "The app knows the home of a thread the list has not seen: the spawn card opens the child in its project, the child's feed leads to the parent in another project"
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127e1-03e3-7450-bc68-604d9047474c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a127b8-b649-75e5-8006-ef59c7eb9c87
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/mobile/Thread.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/activityIdentity.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Header.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThreadSlot.svelte.ts
  - kind: file
    ref: apps/tagma/server/src/threads/harness/state.ts
---
After `c7eb9c87` the app takes a thread's home from the list and Team rows. Two paths remain homeless:
- the spawn card of a child list A has not seen yet opens it in A and gets a server refusal;
- the child feed in B has no crumb to the parent in A: B's list lacks the parent, and the parent's project is unknown to the app.

The server must serve the home wherever the app names a thread: the child's project in the spawn result/record and the parent's project in the thread read. The app takes it from there, with no second inference. Done: both transitions open the thread in its home (state-owner unit tests, narrow checks).
