---
id: 01a16da2-afa8-722b-aa09-8a43b36476b2
title: The testbed reaper falls with EPIPE on freeing after an interrupted world build
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-1e3a-73ae-9e16-b62321fe10a1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16c99-f00e-7823-9cd1-9ae91c6e2051
---
Found by the server-reds-a fixer while checking `enforcement/baseMerge.itest.ts` in the [[1c6e2051]] analysis. Building the shared world exceeded the hook budget (setup interrupted), then the world's reaper release fell with EPIPE. The test not counted, the cause in testbed itself unexamined. The owner is the world-process reaper ([[cb987f4b]]). Done when an interrupted world build frees its processes with no EPIPE and the build failure stays visible. A check through interrupting a real world build needed.
