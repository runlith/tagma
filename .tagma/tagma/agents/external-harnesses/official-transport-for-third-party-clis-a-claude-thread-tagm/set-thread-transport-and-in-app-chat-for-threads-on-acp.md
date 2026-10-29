---
id: 01a1089e-978d-7423-bc88-3a203b3afddb
title: set_thread_transport and in-app chat for threads on acp
ord: 6
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a10838-8f2b-7e30-a2b0-7563adb9cd5b
  - kind: waits-on
    to: 01a1089e-978d-7423-bc88-3a1de25a0bbf
---
Decision 9 and "Architecture" 5 of spec [[adb9cd5b]]: a transport-switch operation, moving the harness thread surface picker out of `View.svelte.ts`, the thread row with its transport and what it proves. The UI is built by Claude models, per the rule. Done: checks 8 and 9.
