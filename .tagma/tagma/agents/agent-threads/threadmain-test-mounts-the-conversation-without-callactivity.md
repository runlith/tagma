---
id: 01a0cb1f-c290-73a2-8492-5e5a004d7f56
title: ThreadMain test mounts the conversation without CallActivity in the manifest
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cb01-11ae-7e80-be80-b58a16fec8e4",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ThreadMain.svelte.test.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/Conversation.svelte
---
`ThreadMain.svelte.test.ts` fails both its tests with `UnknownServiceError: Service "CallActivity" is not in the manifest`, thrown from `Conversation.svelte:78` (`CallActivity.use()`), reached through `ThreadMain.svelte:62`. Commit ecb8a681c4 added the use without carrying the service into this suite's manifest. `ThreadRow.svelte.test.ts` carries the shape: `CallActivity` bare plus `Layer.of(Door, …)` — `Live` is already stubbed and the thread aim is set. Done when both tests pass.