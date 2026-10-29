---
id: 01a1323b-8054-75f6-9a4e-19bd27a3d0b1
title: HeadWatches stays unwatched after error, lost, or polling while subscribers live
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13517-7ef9-7bee-86c8-94a4c7da5f11",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1321c-2265-787f-bcd0-daa6156f2211
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/watch/heads.ts
---
After `error`, `lost`, or `polling`, `watchAll` closes the group, and `HeadWatches` does only one HEAD read and stores the entry; new subscribers get that same entry. It needs an owner recovery lifecycle for HEAD watching in subscription scope, freeing the old group, restoring after the resource returns, and stopping after the last subscriber; a HEAD read failure must not be mixed with a proven absence. Check: after a resource failure and recovery, the next real HEAD shift reaches the existing subscriber, and closing the subscription ends the recovery.
