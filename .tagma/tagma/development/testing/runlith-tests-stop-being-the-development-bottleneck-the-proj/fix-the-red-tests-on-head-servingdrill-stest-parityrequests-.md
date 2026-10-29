---
id: 01a16b3a-adf4-760b-b38e-4345b8db264b
title: "Fix the red tests on HEAD: servingDrill.stest, parityRequests.stest, and the farEdges.itest timeout under load"
ord: 14
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16b3a-f526-7b03-9d33-250f96e9dc1e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16b08-3df5-7646-870f-b2aa7eb43056
---
Found by [[7eb43056]] on 2026-10-24: `servingDrill.stest.ts` and `parityRequests.stest.ts` (4 s timeout) fail with the fixture's old graph rows too. `farEdges.itest.ts`: one test hits the 10 s timeout on the loaded machine in all three measurement steps, including the baseline; the file costs 14.5–15.4 s CPU.
- `apps/tagma/server/src/graph/serving/servingDrill.stest.ts`;
- `apps/tagma/server/src/composition/testing/threads/parityRequests.stest.ts`;
- `apps/tagma/server/src/composition/testing/graph/farEdges.itest.ts`.
