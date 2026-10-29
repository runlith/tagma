---
id: 01a151a7-2500-7166-834a-b185a4dacfec
title: Pass the parent the real approval-question deadline
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151a6-a001-7ba3-be29-65c507d9a74f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a11c26-7d19-7b9a-8bcc-295a52a9ca4e
sources:
  - kind: file
    ref: packages/agent/src/thread/run/questionRouting.ts
---
The native-, hosted- and standalone-question deadline is kept in its record; the approver notification carries an absolute deadlineAt from placement time. A repeat does not restart the clock, and a deadline-free question explicitly has no deadline. `childApproval.itest.ts` checks the notification deadline to the native parent, hosting conformance checks the source deadline after recovery and the deadline-free standalone question. Agent typecheck and 33 checks passed; the full server typecheck is not proven because of errors in three foreign test files.
