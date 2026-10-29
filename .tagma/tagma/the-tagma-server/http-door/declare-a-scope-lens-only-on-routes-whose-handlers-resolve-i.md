---
id: 01a0caee-5b31-7c6c-a490-b288ecd6355b
title: Declare a scope lens only on routes whose handlers resolve it
ord: 2
tags: ["rule"]
sources:
  - kind: dir
    ref: apps/tagma/server/src/http
  - kind: symbol
    ref: apps/tagma/server/src/http/contract/wire/Caller.ts
    symbol: lensQuery
---
A handler resolving scope requires the lens declared on the route: otherwise scope cannot be sent.
