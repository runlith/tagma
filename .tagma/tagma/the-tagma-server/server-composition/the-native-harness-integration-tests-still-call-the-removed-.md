---
id: 01a10337-2c17-755a-93fc-9fa0de9911e2
title: The native-harness integration tests still call the removed `verify_block` and other claims tools
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1031e-d5ce-7656-be01-1b1f6494cb00
  - kind: relates
    to: 01a0f95f-71a5-7ca0-be87-3edc15895a38
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/native-harness/graphCrossing.itest.ts
---
In `apps/tagma/server/src/native-harness/*.itest.ts` and `composition/testing/native-harness/*.itest.ts`, 24 graph tool-door tests fail: "The native catalog mounts no tool for verify_block", `Service not found: tagma/graph/Act`, and similar (2026-10-03 run, recap-impl). Cause: the claims and doctor tools were removed by commits `e92d6e6162` and `0f1db22a90` of task [[15895a38]], while the tests still call them.

Fix the tests for the current graph tool-door contract, or delete those that only protected claims.

Start with `composition/testing/native-harness/graphCrossing.itest.ts`.

Done when these suites pass with no tests on removed tools.
