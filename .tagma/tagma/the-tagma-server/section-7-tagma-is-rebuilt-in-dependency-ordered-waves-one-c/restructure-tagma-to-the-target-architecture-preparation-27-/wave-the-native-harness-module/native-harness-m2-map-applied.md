---
id: 01a0e532-ccc1-799b-82bd-bde34047bdcd
title: "native-harness M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0eaf6-3d86-775e-aa30-9ed7518e0f02",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-c828-7195-a4be-9fc6f3aa2e7e
---
§7.2.2 milestone `M2` of the `native-harness` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

HTTP route debt (from http M2 [[dd5ad950]]): native-harness owes operations for `agents.skills`, `workflows.*`, `threads.composition`, `threads.defaults`/`setDefaults` and `threads.setModel`, plus answer schemas on read_agent_library, read_agent, save_agent, read_thread_agent, read_compaction_choices, read_calls and control_call; each route then retires into `http/retired.ts`.