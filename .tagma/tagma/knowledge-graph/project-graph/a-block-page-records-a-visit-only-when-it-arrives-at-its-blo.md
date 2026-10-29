---
id: 01a183c4-77e7-7392-8953-64830e8226a6
title: A block page records a visit only when it arrives at its block, and a read mark only moves forward
ord: 13
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/BlockPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/ReadState.svelte.ts
---
The Knowledge page and every right-hand block tab are separate block pages writing the same reader marks in app-tier `ReaderMarks`: the visit trail behind the Recent shelf is one list per project, and a read mark is one entry per branch and block. A write re-asserted on every run of the page's read-marking effect makes the pages contest them. Each page put its own block first in the trail after the other had, and Svelte stopped the flush with `effect_update_depth_exceeded`, failing both panes.

So the visit is written in the arrival branch, where the page also takes its diff baseline. A live update or a rename of the shown block re-runs the effect for the read mark only, and is no visit. A read mark only moves forward: two pages holding different stamps of one block (each its own `read_block` answer while the project tree is missing) settle on the later one instead of trading it.