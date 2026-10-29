---
id: 01a1299e-9c53-7c85-a187-fb4338da7749
title: submit_work repeated phantom-left after landing the reflection fix
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Commit 69bb6fc515 landed, but the answer named reflectDoor.itest.ts and the already-renamed reflectWorktree.itest.ts uncommitted. The next read_changes showed held=0, git diff empty; turns keeps printing held. It took extra read_changes, read, and git diff.",
    "command": "submit_work({subject:\"Keep reflections in the source project's main graph\",paths:[\"apps/tagma/server/src/graph/operations/crossing.ts\",\"apps/tagma/server/src/composition/testing/http/reflectDoor.itest.ts\",\"apps/tagma/server/src/composition/testing/http/reflectWorktree.stest.ts\"]})",
    "expected": "Land three paths and name only truly remaining held lines after the commit steps and the test-file rename."
  }
---
Filed from project `runlith`.
