---
id: 01a0c84f-c8db-73c2-9f72-8dcb7eea065a
title: Compare the `state` a loopback callback returns with the one you sent before using its code
ord: 21
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/llm/src/oauth
  - kind: symbol
    ref: packages/llm/src/oauth/callback-server.ts
    symbol: callbackServer
---
The callback server only returns the `state` it received.