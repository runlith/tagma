---
id: 01a159e6-fae1-70af-ae68-e4603b9daf98
title: Task blocking — dependency edges of its own graph and address edges that measurement resolves with one pool question; an unavailable target holds the work
ord: 8
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/acts/far.ts
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/linking.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/acts/measurement.ts
    symbol: blockedCondition
---
`blocked` is still SQL over its own graph, and address edges with `dependency` meaning on tasks in the initial phase are collected by `farMarks` in one query and asked of `farStates` in batches per rule. The finished id set enters the same SQL (`blockedCondition`), so the frontier filter and `total` stay in the database instead of being caught up after the page. An `absent` or `ambiguous` target is not proven finished and holds the task; `ready_work` names such tasks in `held` with "open project" and "unlink edge" exits. Without the calling pool (`RoutedGraphs` empty) the foreign state is unknown and also holds.

The wait cycle at binding is walked through graphs: own edges and `far_edge` — SQL, another graph's steps — `farOutgoing`. A branch that left for a graph missing on this machine breaks off without refusal: there is nothing to prove a cycle with.
