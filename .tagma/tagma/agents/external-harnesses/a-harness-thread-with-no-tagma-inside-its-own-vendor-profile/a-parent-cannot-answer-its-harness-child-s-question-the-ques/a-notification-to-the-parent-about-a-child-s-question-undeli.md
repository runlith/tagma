---
id: 01a1449d-dbb2-72bd-b7ef-892560bbb05b
title: A notification to the parent about a child's question, undelivered once, is never delivered again
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151a6-a001-7ba3-be29-65c507d9a74f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14493-8ddf-74c2-ae0c-8aaf3b8178f6
sources:
  - kind: symbol
    ref: packages/agent/src/thread/run/Questions.ts
    symbol: questionsLayer
---
`Questions.reroute` repeats the open question's notification even with an unchanged approver; repeated `ask` and `approve` also deliver the already recorded question. This covers native, hosted and CLI questions. The envelope has a stable id with the child, run, question and approver: the same questionId from another child or run does not collide with an earlier delivery.

`childApproval.itest.ts` covers the lost first delivery to a native child, recovery through reroute, and a real `inputs.deliver`: after reading, a repeat opens no new run for the parent. Agent typecheck and 33 contract checks passed; the independent [[01a151b1-2c25-7684-aa4b-67b2f40c0485|delivery review]] found no remarks. The full server typecheck stayed red over 11 errors in three unrelated test files; the running server was not restarted.
