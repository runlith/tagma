---
id: 01a0c83a-2e15-77ed-b568-9431ebb5b50e
title: An activity reading pins its ids and their order when it opens, so later pages ignore activities opened afterwards
ord: 17
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/evidence/activity.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/evidence/reading.ts
  - kind: file
    ref: packages/activity/src/store/reading.ts
---
The store fixes the set and order of ids (or a ready group answer) once; a page continues by its position even if an activity later closed and changed predicate, rank or group. Row details are read at the current revision by pinned id.

A reading lives no longer than the activity retention: an expired cursor requires a new question, and an id that departed shows in `coverage.unavailable`.