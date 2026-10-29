---
id: 01a1197b-dc6e-741a-b459-4f59a5447502
title: Refuse an oversized command at the wire limit before sending
ord: 75
tags: ["task"]
fields:
  {
    "holder": "tagma:01a11979-16fc-76b4-988c-8552009fb0ef",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a11971-8260-7fa7-be45-51807077dff3
---
WireSession must use the already declared JSON payload for a command that does not fit the header; the host already reads that shape. On admission, parsed JSON must not remain binary input: the check reproduced sending 25,237 bytes of JSON as the request payload. Exceeding the agreed frame size must give CapacityExceeded with size and limit. Prove through ExecutionClient on a local socket: a large heredoc arrives whole, an oversized request is never sent, the refusal is typed, and the next valid request gets an answer on the same connection.
