---
id: 01a0dfcf-2329-7dfa-806f-db827a5c17f9
title: Remove repeated computation of neighboring threads' activity in the browser
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0dfd1-8886-7272-947a-6b5aae4ba0be",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/harness/CallActivity.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ActivityBadge.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/activityRows.ts
---
Fix the measured load of the activity indicators: CallActivity re-scans the shared array on every thread's request, ActivityBadge joins the shared command list, activityRows rebuilds the process index. In the profile of a working runlith tab over 10 s, ActivityBadge computation with child calls took 2.17 s, garbage collection 2.46 s in CPU samples. Keep the [[8475e42e|call activity and related processes]] semantics, history, and controls. When one call changes, unchanged threads must keep their selections; computations depend on the changed records, not on the total row count. Check owners against the real contract and compare cost on the same scenario; run the mandatory review, update the affected claims, and finish with a commit.
