---
id: 01a0c83a-2e15-77ed-b568-9431ebb5b50e
title: "Reading activity pins the moment it opened at: activities opened later are not in its pages"
ord: 17
tags: ["rule"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/evidence/activity.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/evidence/reading.ts
  - kind: file
    ref: packages/activity/src/store/reading.ts
---
The store pins the set and order of ids — or a ready group answer — once; a page continues by its position even if an activity later closed and changed predicate, rank, or group. Row details are read at the current revision by pinned id. A read lives no longer than the activity retention; an expired cursor requires a new question, a departed id shows in coverage.unavailable. Before a query, the store flushes pending facts; a failed flush shows in coverage as an incomplete read.
