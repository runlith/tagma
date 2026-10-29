---
id: 01a15ba6-6aca-7c3d-990f-134b5db0884f
title: A run whose ACP driver restores the turn after death says so in the run row and the thread-list row
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15b88-e429-73d6-a7bb-5e1330521d6e",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15ba6-6aca-7c3d-990f-134895cada01
---
Core and ACP per [[95cada01]]: when the transport knows a run's stop reason (recovery after driver death), it goes into `RunStatus` and the thread-list row instead of the nameless "no movement for a long time". Recovery rails are [[700ff263]].
