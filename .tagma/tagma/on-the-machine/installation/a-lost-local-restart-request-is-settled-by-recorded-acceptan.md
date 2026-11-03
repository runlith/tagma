---
id: 01a1a25d-509f-7633-8b5b-18111f84f1f9
title: A lost local restart request is settled by recorded acceptance and directory ownership
ord: 74
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/installation/process/serverStart.ts
    symbol: requestRestart
---
A transport failure does not prove that a restart was accepted. The CLI waits while a recorded handover or a held data directory can still complete the request; when neither remains, it returns the transport failure instead of waiting for a record no process can write. A remote address supplies no local ownership fact and keeps waiting for its server's published outcome.