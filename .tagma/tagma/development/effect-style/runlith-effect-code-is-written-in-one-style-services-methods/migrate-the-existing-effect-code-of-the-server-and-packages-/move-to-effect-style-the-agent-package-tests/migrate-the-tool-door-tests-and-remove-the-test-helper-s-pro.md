---
id: 01a13deb-4b3f-78f4-98b8-19873825549f
title: Migrate the tool door tests and remove the test helper's Promise facade
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/door/CallLedger.test.ts
  - kind: file
    ref: packages/agent/src/agent/door/ContributorWithdrawal.test.ts
  - kind: file
    ref: packages/agent/src/agent/door/OutputProjection.test.ts
  - kind: file
    ref: packages/agent/src/agent/door/testing/open.ts
  - kind: file
    ref: packages/agent/src/agent/door/ToolAdmission.test.ts
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecution.test.ts
---
Migrate the five tool door tests and their shared helper to direct scoped Effect operations: admission, single-flight/replay, contributor withdrawal, execution and output projection. Remove the test Promise facade and extra slices/casts, keep inputs, outcomes, pre-side-effect refusal and races through Deferred. Delete copy-pinning and artificial-facade tests with an account. Proof is the group's green tests, typecheck, check_law and one review round.
