---
id: 01a16a45-7ef6-7439-9017-85a2033b5e88
title: "A copy's opened event arrives before the opener's answer, and closed after the tree is closed and released: on one tree the old copy's closed always precedes the new copy's opened"
ord: 9
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/service/serving.ts
    symbol: CopyEvent
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/copies.ts
    symbol: makeCopies
---
Subscribers — the remeasure, the worktree feed, mirror cleanup — use `opened` to start their work over a copy, and `closed` to drop it or take the tree.

`opened` is published synchronously at the moment the record is published, under the tree gate: a judgement arriving through the pool sees the event before its own act. A subscription replays the `opened` of already standing copies in the same synchronous step, so a subscriber created after the pool misses nothing.

`closed` is published after closing has handed off the copy's processes and released the tree gate, in the same step — before a waiter on the gate has reopened the copy. If `closed` were published at the moment the record was dropped, a subscriber that tries to take the tree without waiting in response would find the gate held and never learn that the tree became free.
