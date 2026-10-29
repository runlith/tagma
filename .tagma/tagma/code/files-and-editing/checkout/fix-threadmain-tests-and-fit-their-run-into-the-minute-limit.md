---
id: 01a1282f-2f97-7abb-9e3c-79fbbbcff460
title: Fix ThreadMain tests and fit their run into the minute limit
ord: 7
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12812-89b3-78cf-8d61-fdf662f24a1d
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/ThreadMain.svelte.test.ts
---
Take apart the two `ThreadMain.svelte.test.ts` failures, fix the cause at its owner, and check both scenarios of returning from a file to the conversation. When a narrow run does not fit the command's minute limit, shrink the imported area or split independent subjects without raising the limit. Both failures come from a missing `ThreadList` in the test manifest. The fixture receives this service; the conversation-contributions catalog is replaced with an empty public answer, because the test's contract is keeping the conversation and its scroll when opening a file and returning to it after a thread switch. Checked on one machine: the file's full run fell from 55 to 19 seconds, both tests pass.
