---
id: 01a12997-a9d1-7c31-a95b-c5dd42b2b5b0
title: ManagedWorld is verified from the thread's real caller and completes the full system file
ord: 7
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12971-3785-7fc9-9f5d-1a7e940a49fb
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/executions/managedWorld.stest.ts
---
Fix the caller fixture and the cause of the missing call-ready.txt, keeping grants, change ownership, and stops with their thread/run; the full `managedWorld.stest.ts` must fit in 60 s, target below 45 s. Delivery `05e4a9b883`: a real caller removed the pre-launch refusal; a separately found accepted-command read failure was fixed at [[b5c77188|the reader's owner]]. Full managedWorld: 8/8, 42 assertions, 8.94 s; CommandInventory with parked-setup red/green and reader cancel: 11/11, 6.02 s; readerRelease: 1/1, 4.98 s. These are samples on macOS; a green full typecheck is unproven.
