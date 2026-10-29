---
id: 01a16527-352c-7185-bffb-40504e0a5402
title: "Task-holder standing is a graph port: an abandoned task is taken without asking, ready_work shows it, \"In work\" keeps only the living"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16509-151f-7593-9b15-10ddf97bd084",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16527-352c-7185-bffb-404d3490910c
---
The `HolderStanding.of(keys)` → `working | rested | failed | gone` port is declared in the graph contract and filled by `threads/events` with the same derivation that `rested` gives. For a root holder only `gone` counts as abandoned; for a child holder everything but `working` does.

What changes:
- `heldElsewhere` (`graph/work/tasks/holding.ts`) raises `held-elsewhere` only for a non-abandoned holder.
- `ready_work` gains `since` on every row and two counted, paged groups: `idle` — abandoned in-work tasks with holder standing; `specs` — open specs with no open work. A task with no performer shows its age and author.
- "In work" in the orientation (`prime.ts`) shows only tasks of non-abandoned holders; the rest go in one counted line.

Tests:
- in review, closing the task of a vanished child does not ask, of a working one asks, of a stopped root asks;
- `ready_work` yields the abandoned task in `idle`;
- a new thread's orientation does not carry it as a line.
