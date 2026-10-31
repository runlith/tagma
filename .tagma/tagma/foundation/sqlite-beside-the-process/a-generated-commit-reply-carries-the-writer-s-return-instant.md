---
id: 01a18f5e-7646-7984-84ef-27fecab111bc
title: A generated COMMIT reply carries the writer's return instant without another acknowledgement
ord: 19
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/sqlite-process/src/channel.ts
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/host.ts
---
The writer captures `performance.timeOrigin + performance.now()` immediately after the existing generated COMMIT call returns, before sending its ordinary Rows reply. The number is epoch-anchored high-resolution milliseconds, not a server-loop receipt or publication time. It is comparable in epoch across processes on one machine but promises no bound on clock-origin skew; a wall-clock correction between process starts can separate their origins. A failed or unacknowledged COMMIT supplies no instant, even when durable storage may already have changed. This metadata is excluded from logical payload-byte accounting and adds no SQL, message, serialization pass or acknowledgement boundary.