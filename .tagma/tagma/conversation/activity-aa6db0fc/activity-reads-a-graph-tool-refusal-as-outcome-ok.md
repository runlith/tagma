---
id: 01a13291-8f20-7ef0-a839-cc441b1faa6b
title: activity reads a graph-tool refusal as outcome=ok
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "Every activity row for these calls carries outcome=ok, reason=null. The refusal shows only in the entries records: entry.toolState=output-refused, entry.toolRefusal.code. Over a day, activity shows 0 graph-tool refusals; entries show 6 (create_block 2, link_blocks 3, update_block 1).",
    "command": "read_thread threadId=01a125fe-9260-7644-9a64-589c9bc19e19 select=activity where kind=tool-call, openedAt>=2026-10-12T23:30:00Z, attrs.toolName in [create_block, update_block, link_blocks] (project runlith)",
    "expected": "The create_block (23:33:28, 23:33:32) and update_block (23:33:53) calls, whose entries records carry toolState=output-refused with toolRefusal.code (body-shape, status-operation), appear in activity with outcome=refused or with the refusal code."
  }
---
Filed from project `runlith`.

Measured by the graph-refusal-census agent, reads only. Activity is unfit for counting graph-record refusals; the refusal code comes from entries at `entry.toolRefusal.code` (duplicated in `entry.toolOutput.code` with `unblock[]`).
