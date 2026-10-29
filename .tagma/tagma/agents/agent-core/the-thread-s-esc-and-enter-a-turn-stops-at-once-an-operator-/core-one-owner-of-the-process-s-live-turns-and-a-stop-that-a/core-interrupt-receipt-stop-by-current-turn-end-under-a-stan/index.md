---
id: 01a15f02-9076-792c-996d-a37d52435a17
title: "Core: interrupt receipt, stop by current turn, end under a standing request as aborted, one owner of live turns"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f02-5d56-794f-92b0-0c653f45b43a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d47031f1f3
---
Implementation of [[7031f1f3]]: first behavior — the `interrupt` receipt, `stop_run` answers, ending under a standing request, `sweep` after the answer — then reducing live turns to a single owner.
