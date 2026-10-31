---
id: 01a16d22-0d5a-74db-b560-67bcbf9c19c4
title: A removed project blocks deleting another project's thread through the old footprint
ord: 72
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16d22-7d3c-781f-9c56-f5d5edaa6b26",
    "status": "done"
  }
---
After `create_block` by a thread from A into B, `remove_project(B)` succeeds, but `delete_thread` of the same thread in A answers `409 thread-tasks-unreadable`: `HeldTasks.copiesOf` opens the removed B from `WorkPlaces.held`. Confirmed through the HTTP door with the thread's grant; the unblock offers only the project list and a retry once the graph is available. The fix must preserve handover of real held tasks when a project is removed, not skip the unavailable graph. Reproduction: root in A, idea in B from its grant, remove B, delete root through A. Take apart the project-removal owner and foreign footprints, add a red-then-green check through that door.

Resolution: thread places in a removed project are kept by `WorkPlaces.held` but not answered; while the project is removed, tasks there stay with the thread's session, and after the project returns they hand over at thread end as usual ([[9105ff3f]]).
