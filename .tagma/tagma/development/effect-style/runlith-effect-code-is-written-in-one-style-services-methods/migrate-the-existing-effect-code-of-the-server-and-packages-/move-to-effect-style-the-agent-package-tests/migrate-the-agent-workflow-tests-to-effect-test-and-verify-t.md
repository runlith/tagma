---
id: 01a13dc3-1555-7d55-8643-703e00b5f957
title: Migrate the agent workflow tests to effect-test and verify the lease on managed clocks
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/package.json
  - kind: file
    ref: packages/agent/src/workflow/conformance.ts
  - kind: file
    ref: packages/agent/src/workflow/engine.test.ts
  - kind: file
    ref: packages/agent/src/workflow/engine.ts
---
Migrate the workflow engine tests and the shared storage-conformance to effect-test, keeping the external SQL adapter factory. Verify lease and renewal through TestClock; fix the found Date.now/Effect Clock mixing at the engine after a red test. Proof is the workflow and SQL-conformance tests, agent typecheck, clean check_law and this group's review.
