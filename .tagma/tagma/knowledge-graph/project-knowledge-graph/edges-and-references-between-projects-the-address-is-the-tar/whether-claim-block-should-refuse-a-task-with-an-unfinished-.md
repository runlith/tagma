---
id: 01a159ae-2c87-7eea-be0d-53329aac660c
title: Whether claim_block should refuse a task with an unfinished waits-on blocker — its own or from another graph
ord: 3
tags: ["idea"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/work/tasks/holding.ts
---
Now `claim_block` (`graph/work/tasks/holding.ts`) never reads edges: a task whose `waits-on` is unfinished can be taken. Only the `ready_work` frontier holds it. Describing cross-project edges, the operator named "taking a task" an act the gate guards.

Question: should `claim_block` refuse a task with an unfinished blocker — its own or from another graph — with the "unlink the edge" way out and, for an unreachable target, "open the project"?

For: behaviour matches how the operator described it, and an agent never takes work that cannot be done yet. Against: today taking a blocked task can be deliberate — to start preparing, for example. The gate would change behaviour inside one graph too, not only between projects. The operator decides.
