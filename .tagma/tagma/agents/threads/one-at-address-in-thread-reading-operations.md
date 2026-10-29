---
id: 01a12837-ae3c-7e10-a44f-624321ca70a9
title: One `at` address in thread-reading operations
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12837-41a7-7c43-a2be-12c244e1102b",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/wire.ts
---
Fix the `read_thread_record` response and the thread-reading operation descriptions: a record position is addressed and returned as `at`, so it can be used in `read_thread` with no `unknown-field`. Start with the wire contract and its producer in `threads`; remove the old name with no second form. Check the existing response-shape test, if any, and a within-a-minute typecheck; land the change and finish the task with a commit. Do not touch the operator's server. Result: wire contract, full and narrowed response, `conversation` messages and descriptions use `at`; existing tests extended to reuse the address in `where`/`order`/`fields`. Diff and 19 conversations tests checked; the narrowed-response test passed. A request with the expanded address returned HTTP 200 and the wanted row, after which the required-`threadId` expectation was clarified; the final run of that test never reached its checks due to a fixture timeout and HTTP 409 on `add_project`. The minute-long typecheck did not finish and reported TS2769 outside the change in `packages/agent/src/thread/conformance/runStop.ts:73,77,79`.
