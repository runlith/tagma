---
id: 01a192d3-e459-70ce-ae6c-dcda8bc94a1b
title: Resolve abandoned pending stops and let Restart bypass a waiting ACP halt
ord: 209
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19298-acff-74fa-a3ea-69463c4b9829",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a19298-4fa4-74c7-be00-c13de8b1ef43
---
A server update left an ACP runner live with a halt key still Pending, and the successor kept waiting for that key after the old server's stop fiber had gone. Restart on the successor did not reach its independent replacement stop. Reproduce both paths through the real ports, resolve ownerless stop outcomes at the executions owner, and remove the dependency that lets an older halt block replacement.