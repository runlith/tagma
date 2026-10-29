---
id: 01a14771-de18-7ce6-820b-616bd1c69c23
title: No door reads a thread's composed tool schemas or pages a large activity request body
ord: 6
tags: ["reflection"]
fields:
  {
    "actual": "read_agent returns prompt sections only, no tools; read_thread_record marks the request body `unread` even when read alone, and offers no paging — sizing the 71k chars of tool schemas needs a hand-written script over activity bodies.",
    "command": "read_agent {id:\"tagma\"} (to size tool schemas) and read_thread_record on a first-request activity address (235,725 chars)",
    "expected": "read_agent answers the tool catalog the startup composition offers (names, eager/deferred, schema size), and an oversized activity body can be paged like a tool output (outputFrom)."
  }
---
Filed from project `runlith`.

Met by the usage-census agent 01a1476f-039f-762e-9c9b-5e8c63eaf781 measuring startup cost of the native agent; earlier the same need was met with a scratch script (rebuild.ts) in thread 01a125fe-9260-7644-9a64-589c9bc19e19.