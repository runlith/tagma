---
id: 01a1ad01-d095-75d3-a7e0-5f71f53789c4
title: One live request's defect ends that request, never the connection and every other feed on it
ord: 26
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a12f9e-8106-7371-95b7-ec9e651a2eb8
  - kind: relates
    to: 01a1555f-65b1-7c70-bd34-9cb28c0ddf3f
sources:
  - kind: file
    ref: apps/tagma/server/src/socket/live.ts
---
Effect's RPC server answers a handler's defect with a connection-wide `Defect` frame unless `disableFatalDefects` is set, and the client answers that frame by failing every request in flight on the socket. Each feed then re-subscribes, so one thread whose read dies ended every thread, list and pending call of that window several times a second, and the thread at fault was never told apart from the rest.

With `disableFatalDefects` the defect travels as the `Exit` of its own request: `socket/live.ts` logs and records it against its endpoint, the client's other requests never notice, and the failed feed re-reads under its own backoff (`feedRetry`). The connection-wide frame remains only for what no request owns, such as a protocol write that fails.