---
id: 01a12864-b959-760f-8227-d903e3f0c169
title: A capacity refusal on fd receive does not mean losing the holder
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: packages/execution-host/native/src/channel.rs
    symbol: receive
  - kind: symbol
    ref: packages/execution-host/src/holder-client/Connection.ts
    symbol: connect
---
On macOS, `recvmsg` short on handles already removes SCM_RIGHTS but leaves the payload in the socket. So the receive keeps the single frame's boundary and delivers the capacity refusal together with its bytes: otherwise the next answer would lose handle correspondence. A launch the logic did not accept finishes at the holder and passes exit observation, reap, and release before the refusal answer; previously held executions and the channel keep living.
