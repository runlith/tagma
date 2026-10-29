---
id: 01a127f9-84fe-7e0f-9a65-f7e5fac1398c
title: executionSpawner.itest `an ending says what the signal declared` hangs to the 10 s timeout, on main too
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a127f0-b368-7fbf-ae46-f6f97d07185e
sources:
  - kind: file
    ref: packages/executions/src/executionSpawner.itest.ts
---
The test `an ending says what the signal declared: a typed abort, an untyped one, and an untouched scope` in `packages/executions/src/executionSpawner.itest.ts` never finishes and breaks on the 10 s timeout. It reproduces on `main` 5337894fba with the same command `bun test --isolate ./src/executionSpawner.itest.ts` from `packages/executions`, so it was not caused by the work on optional fields. The cause is unexamined.

Done when the test passes or the stale contract it holds is fixed.
