---
id: 01a15e6b-f18e-7a5e-9b69-b73c2e088169
title: "The plain tail in graph/serving tests: projects, recovery, machineWriter, routing, and mirrorMove/storageMove"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15e61-f93a-7b22-87a7-830d27c4170b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15e61-d6ef-7bf3-b089-23b203c2c6d6
---
Not taken in the mechanical fixture port (1599d5b4 and its follow-up): `graph/serving/projects.itest.ts` (the "a plain project names its measured tree…" test, plain `setStorage`), `graph/serving/recovery.itest.ts` (the `['team', 'plain']` parameter), `graph/serving/machineWriter.itest.ts` (the `plainServed` helper, plain layout and `setStorage`). Tests with the plain layout and `resolveStorageLayout({ mode: 'plain' })` — `graph/serving/routing.itest.ts`, `graph/serving/mirrorMove.stest.ts`, the storageMove tests — await the spec owner's contract review and are ported by it. Plain-test names change by meaning, not mechanically. Also `graph/storage/layout.test.ts` (lines 18–19, `resolveStorageLayout({ mode: 'plain' })`) — outside the above list, ported by the same review.
