---
id: 01a15cbb-ab30-7372-8f9b-2b138d91efe8
title: Terminal input survives a host logic change and resumes on its own after the connection recovers
ord: 36
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15cb6-1978-771a-bcd2-d8b724abf0e3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15c5c-d764-7aca-9b65-9090251c93cd
---
Found by the terminal delivery review. `InputFenced` with cause `yielding` is a temporary handover of input to the new logic while the child lives, but the host folds every cause into one code, and `Input.ts` on it switches input off forever without telling the pane the outcome. And if the first lane-open attempt fell on transport, typed input lies until the next key or focus: the open owner has no resume after the connection recovers.
