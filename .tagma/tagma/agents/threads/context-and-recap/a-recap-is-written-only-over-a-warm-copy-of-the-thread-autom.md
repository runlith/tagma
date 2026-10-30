---
id: 01a14ced-642d-7b2d-b847-28f9eba592c4
title: "A recap is written only over a warm copy of the thread: automatic and manual alike, a cold or unknown cache refuses"
ord: 12
tags: ["rule"]
fields:
  {
    "delivery": "code"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/threads/recap
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/thread/ThreadRecap.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/RecapCard.svelte
---
No recap retells the journal with another model. A manual request on a thread whose transport holds no warm copy, or whose cache deadline is unknown, is refused, and the interface says why.