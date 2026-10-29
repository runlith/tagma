---
id: 01a1325e-fa12-70a6-ba85-9604fdc2fa5c
title: "Carry-review findings landed: exact pairs, one move projection, a bounded no-owner path list"
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1321e-0f91-767d-96d0-1c06c1dbc31b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13236-64ca-761e-999f-75e717872cd0
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/moves.ts
---
Apply the confirmed findings of the `71543d4b49` review (submit-review-main, -perf, -attrib) with the lead's decisions: exact staged moves; no overlap-side assignment for empty and short content; journal batch width; a bounded and indexed list of no-owner paths with cleanup after landing and at thread end; one move projection for landing and Holdings; a move pair from the session's lines across commands; a post-carrier-lines snapshot of the selection; a refusal advice naming the pair; no-owner paths in `read_changes` by path; a test layer.

Done when the unit/itest/stest contracts pass and the delivery is landed.
