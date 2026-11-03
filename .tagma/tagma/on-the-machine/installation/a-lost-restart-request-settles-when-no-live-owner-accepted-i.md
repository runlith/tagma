---
id: 01a1a258-2d52-7822-b8b8-95a5236b25e1
title: A lost restart request settles when no live owner accepted it
ord: 68
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a245-7a51-7739-a251-86d1ad1d1996",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a123b2-171e-70e1-bb12-ce0d2e4c21a3
---
If the server dies after the CLI reads its state but before it accepts restart_server, requestRestart waits forever for a record nobody will write. Settle the unknown outcome from acceptance and owner liveness through the public restart path, preserving a genuinely running handover.