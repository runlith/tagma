---
id: 01a0caee-5b31-7c6c-a490-b288ecd6355b
title: Declare `lensQuery` on every route whose handler resolves scope
ord: 2
tags: ["rule"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/http/contract/wire/Caller.ts
    symbol: lensQuery
---
Without the lens on the route, the caller cannot send the scope.