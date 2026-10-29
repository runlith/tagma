---
id: 01a14dae-5ab5-7a60-8d61-8aa8108b4c32
title: Waiting for welcome ends with the connection scope
ord: 9
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/executions/src/WireSession.ts
    symbol: wireSession
---
Cleanup of a managed handle may request a reconnect while its shared scope is already closing. A fork in a closed scope need not start reading the socket, so the welcome answer cannot rest on the reader's completion alone: the connection scope itself closes the wait. Otherwise the handle finalizer waits forever for a handshake nobody is left to perform.
