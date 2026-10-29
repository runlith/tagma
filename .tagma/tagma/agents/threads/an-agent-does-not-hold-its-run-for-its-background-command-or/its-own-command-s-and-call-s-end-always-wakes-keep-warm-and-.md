---
id: 01a17aed-c2a9-727a-a27e-a3b91b906fec
title: Its own command's and call's end always wakes, keep-warm and the fallback report await them, wait_command, wait_call and read_output.wait are deleted
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17aee-3557-7125-be88-f767407b15a0",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a17aed-c2a9-727a-a27e-a3b8b67d7441
---
Implements [[b67d7441]] in full, in one change: waking, keep-warm, fallback report, removal of waits, and texts are linked and leave the agent with no way to continue its work separately.
