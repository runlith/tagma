---
id: 01a16c60-39cd-7bc9-a422-4237df8a047b
title: "Fix the new thread, harness, and browser failures: runLog.continues.itest, hookContext.itest, conversations.stest, managed-browser/installed.stest; EISDIR in check:change and the never-ending bench-project-birth"
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16c60-ca01-7fb7-a00a-848b6cf906f1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16c5d-ff92-708b-9d5d-fed108f81bea
---
Found by the "after" measurement [[08f81bea]]; each file's first failure is there. `scripts/change/inputs.ts:100` reads a catalog through `readFileSync` (EISDIR) on all three sample calls; `scripts/bench-project-birth.ts` never exits after the measurements and writes `WireUnavailable`.
