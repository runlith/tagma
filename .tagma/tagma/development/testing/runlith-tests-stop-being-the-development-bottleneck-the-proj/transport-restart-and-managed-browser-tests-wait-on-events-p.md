---
id: 01a16fbd-b52f-7f28-b530-231c2a4407cc
title: "Transport, restart, and managed-browser tests wait on events: protocolTransport, protocolRoad, terminalConformance, claudeConformance, restart, managed-browser host, screencast, engine, providerTransitions, requestObligation"
ord: 43
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16fbe-7656-7e61-b2b2-82a6284d9b01",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
  - kind: relates
    to: 01a16fbd-b4fa-7f3d-8686-f6122255f40d
---
These files wait 15–40 s at 7–20 s CPU; restart fails on its 55 s timeout under load, while the providerTransitions and requestObligation unit files fail on the 1 s timeout. Find what each test waits for and wait on the owner's event; logic through a whole world — to unit under [[4dbd9a84]]. Acceptance: wall and CPU before and after, green on seeds 1–3 and next to parallel load, no raised timeouts, no skips.
