---
id: 01a179c9-bfb4-76ab-8a43-40403920e213
title: An unclosed-storage server process end and a post-door process exception show as error-list rows
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a179c9-bfb4-76ab-8a43-403ac8860d90
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/attempt.ts
  - kind: file
    ref: packages/activity/src/store/ActivityStore.ts
---
Activity storage marks the live process with a direct write on open and an end mark on close; an open finding the previous process's mark with no end writes one `server exit` line with the previous process's start, the last note's time, and the count of orphaned activities — with no conclusion about the cause. After the door, `uncaughtException` and `unhandledRejection` handlers lay a `process` defect into the log with no IO at the call site, wait for `ActivityLog.settled` no longer than the storage's close deadline, and do not change the process's outcome. [[7877d364]] is fixed by the same change.
