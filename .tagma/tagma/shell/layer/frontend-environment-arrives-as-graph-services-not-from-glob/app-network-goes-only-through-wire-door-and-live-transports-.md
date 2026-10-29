---
id: 01a14fe9-9f2a-77a2-b527-f53d09386eb6
title: "App network goes only through wire: Door and Live transports are ports, binary routes in the contract, ServerOrigin and SoundChannel"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14ff7-5492-7b9f-bfc2-30ed5130e859",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14fd8-3e41-7f9d-909a-f909b96e483e
  - kind: waits-on
    to: 01a14fd8-68cd-7412-b239-945d0da3edb9
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/wire
  - kind: file
    ref: packages/layer/src/Platform.ts
---
Task 3 of spec [[b96e483e]], the "Network" and "Misc" sections of the audit [[dbf104d3]]. `Door` and `Live` transports are ports filled by composition (`Platform.fetch`, new `Platform.socket`); `ServerOrigin` (http, socket, local, artifacts, sandbox) removes the loopback lists and module variables with the `/health` reply; binary routes (checkout image, recording sound and peaks, attachment, file preview) declared in the server contract, `Door.address`/`Door.bytes`; `admission` and `pair` through `Door`; `SoundChannel` for dictation; `ChatEntryHandlers.readAttachment` in `chat-ui`. All `Platform` changes in Layer (`socket`, `databases`, `locks`) go in this task. Work per the frontend skill [[0da3edb9]]. Proof: the region has no `fetch`/`WebSocket` outside the audit-allowed places, `wire` tests through public `Door`/`Live` pass, the app typecheck and build pass.
