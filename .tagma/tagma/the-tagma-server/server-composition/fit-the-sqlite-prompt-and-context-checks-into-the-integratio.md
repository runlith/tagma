---
id: 01a14bee-5b1b-73e6-95e4-0c5d400ce7e7
title: Fit the SQLite prompt and context checks into the integration layer's CPU budget
ord: 19
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14bdf-0875-710f-96aa-0c4186e6d82d
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/native-harness/runLog.prompts.itest.ts
---
The `apps/tagma/server/src/composition/testing/native-harness/runLog.prompts.itest.ts` check gave 13 pass and exit 0, but test/layers.ts measured 8,799 ms CPU against the 8,000 ms budget (2026-10-17, `bun test --parallel=1`). Find the cause of the fixture and run cost and remove it at its owner; repeated launches for a green measurement are not a fix. Finish when the same public contract is verified in the layer's budget without weakening the checks.
