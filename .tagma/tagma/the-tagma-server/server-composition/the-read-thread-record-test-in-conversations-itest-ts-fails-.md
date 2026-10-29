---
id: 01a137e4-fc0b-7b32-b683-7b2a8fa2ffe6
title: "The read_thread_record test in conversations.itest.ts fails: the fixture does not provide the tagma/graph/Tags service"
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae6-7c7d-9cc2-edc404b6eb7f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13796-6e99-731d-9f9b-83b8ba5f090c
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/conversations.stest.ts
---
"a match search_threads hands the agent opens with read_thread_record" in `composition/testing/threads/conversations.itest.ts` fails with `Service not found: tagma/graph/Tags`. It also fails on `main` (`e2bb6810c1`), so not because of the call branch: the call-search task that touched this file found it. Start from which fixture layer should give `Tags` to the `read_thread_record` read. Done when the test passes.
