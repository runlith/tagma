---
id: 01a12ae3-66da-703c-bae5-a4101ad64bfd
title: On macOS recvmsg answers EMSGSIZE when the logic has no room for the passed descriptors
ord: 8
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12735-55f2-75e0-95d7-53127c1b6811
sources:
  - kind: symbol
    ref: packages/execution-host/native/src/channel.rs
    symbol: receive
---
When receiving SCM_RIGHTS on a macOS stream socket, a short fd table can surface as `EMSGSIZE`. That refusal concerns descriptor receive, not frame size: the payload must still be read without rights, so the holder client parses the answer, rolls back the launch, and reports `CapacityExceeded`, keeping the channel for the next requests.
