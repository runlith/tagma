---
id: 01a0e532-cd22-7f1c-8fcf-c0b636bb8530
title: "external-harnesses M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e5ce-0070-75a0-8f80-bc9315d3b0c5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-c828-7195-a4be-9fc6f3aa2e7e
  - kind: waits-on
    to: 01a0e532-cd15-715f-9e9a-7f337ef8ff1f
---
§7.2.2 milestone `M2` of the `external-harnesses` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

HTTP route debt (from http M2 [[dd5ad950]]): the hook road still speaks typed routes — external-harnesses owes operations for `harness.*` (report, answer, permission, permissionOutcome, stop, acknowledge, adopt), for the hook's session start, first prompt and touch (`/api/session-start`, `/api/first-prompt`, `/api/touch`) and for the reported change record (`/api/changes/record`, whose proven writer the operation must take from its call), an answer schema on read_installation_status so the hook's `/api/doctor` becomes run_doctor beside it, and answers on speak_harness and read_harness_screen; each route then retires into `http/retired.ts`.