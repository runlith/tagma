---
id: 01a11d5b-4c75-715c-9958-13604ac1f3ae
title: An outside write right after the operator's save doesn't reach the open document
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de7e-cfec-7720-827e-07d2bf8b59c6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a117dd-98e5-7df2-86cb-e3f13b5e7d6f
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-files/documents/open.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/checkout-files/writes.itest.ts
---
An outside write right after the operator's save was lost: the editor stayed on the old text, and the `writes.itest.ts` test "the document frame a save causes carries its id…" timed out.

Cause: Bun on macOS serves every `fs.watch` of a process from one FSEvents thread and restarts it whenever any watcher opens or closes. Events the thread hasn't delivered yet are lost in the restart. After a save the change record opens HEAD watchers (`.git`, `.git/logs`, `refs/heads`), and the outside-write event is dropped. Reproduced with a standalone script with no Tagma: a write, 9 ms later another watcher opens or closes, and the event is gone.

Fixed in `watchAll` (`platform/watch/tree.ts`): on macOS opening or closing a watcher sends every other live watcher `rescan: 'unnamed'`, and their consumers re-read the disk after the restart. Test `tree.itest.ts`; the failing test passed 10 runs in a row; 95 integration tests of watcher consumers green. Commit `9dcfb929e1`.
