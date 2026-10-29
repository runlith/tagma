---
id: 01a127e0-dee2-7c48-839e-50fd7764b038
title: move_thread and Assignments.under accept a cross-project lineage
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127e1-03e3-7450-bc68-604cf78ae7cd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1278d-8205-7cda-9971-7eb4b6306ce4
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/birthPlace.stest.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/assignments/membership.ts
---
After `b6306ce4` a child may live in another home, but `move_thread` and `Assignments.under` refuse `cross-project` for such a lineage. Thread moves and assignments are judged by each thread's home (rule `30cfaf9e`: the "thread and its home" pair), not by requiring one project for the whole line. Find the refusals (grep `cross-project` in threads), drop the single-home requirement where unneeded, keep the thread/home pair check. Done: a move/assign test in an A→B line. Delivery `8400707c66`: home comparison removed from `Assignments.under`, the both-participants-exist and descendant checks kept; the unused reason removed from the wire and the move mapping. Verified red→green: 5 assignment integration tests (including A→B→A and out-of-reach), 2 birth/move system tests (wrong home, replay, home immutability), narrow typecheck of three sources, and diff. Sol xhigh and two Muse xhigh lenses — no findings. Typecheck of the five changed files was stopped by the 1-minute limit; test-file types are not proven separately. The working server was not restarted.
