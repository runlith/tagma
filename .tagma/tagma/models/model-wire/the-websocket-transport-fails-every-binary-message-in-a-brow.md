---
id: 01a0c8cb-04bd-79df-9c80-d1fbef6f1dc1
title: The WebSocket transport fails every binary message in a browser and silently drops the 129th
ord: 40
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/llm/src/llm/route/transport/websocket.ts
---
`binaryType` is never set on the socket, so in a browser binary messages arrive as `Blob` — which the reader cannot read and which fails the whole stream as invalid-output ([[08a6a766]]). Separately, the message queue holds 128 and `offerUnsafe` returns false past that, so the 129th message is dropped with no backpressure and no report ([[296b63cc]]).