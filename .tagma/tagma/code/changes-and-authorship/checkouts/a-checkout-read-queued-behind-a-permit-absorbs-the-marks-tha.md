---
id: 01a1402c-3f97-7ea1-a7ad-bae8518547d2
title: A checkout read queued behind a permit absorbs the marks that arrived before it started
ord: 17
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a12754-6b19-7b51-b05d-d2e9153018fe
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/comparison.ts
    symbol: sharedTree
---
The epoch, paths, and mark reasons are taken at the moment the read acquires the permit, not when it queued. Until the read starts, every new reader joins it no matter which mark arrived: git has read nothing yet, and that read will see everything that changed before it started. A mark arriving after the start raises the epoch above the taken one and yields exactly one follow-up read.

Without this, at startup each `unnamed` from an FSEvents stream restart arriving while the first read waited on one of the three permits cost one more full `git status` of the same checkout. A read cancelled in the queue takes nothing: its marks stay for the next one. A reader that joined a not-yet-started read rereads on its own if that read fails: otherwise the marks it brought would leave with the failure. The read after a failure is a full one.

`refs` and `head` marks do not reach `onMark` listeners at mark time. So a read that absorbed them and saw a different HEAD or ref reports the whole root (`treeChanged`) to listeners — even if it absorbed named paths along with them. On such a read's failure the listeners get the whole root too.
