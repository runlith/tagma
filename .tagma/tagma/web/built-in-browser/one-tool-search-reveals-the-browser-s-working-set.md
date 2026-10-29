---
id: 01a184cf-1943-70b5-ab31-8694fc170abf
title: One tool_search reveals the browser's working set
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a184cf-76ca-7d83-87c6-2f78805e2612",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-04644096201b
---
Before its first page an agent calls `tool_search` for `open_page`, then again for `snapshot_page`, `act_on_page` and `capture_page`. The `companions` mechanism reveals a tool together with deferred tools whose ready call its answer prints (explanation 1d85e344; `AgentDeferredTools.ts`), and browser operations declare none. Make `open_page`'s answer hand the agent its next calls on the page it opened and declare those as companions, so one search reveals the working set within the mechanism's contract — not by declaring companions the answer does not print.