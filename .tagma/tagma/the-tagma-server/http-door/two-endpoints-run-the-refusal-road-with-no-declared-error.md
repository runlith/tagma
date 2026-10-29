---
id: 01a0caf1-2113-7113-8e74-3a303d0207e4
title: Two endpoints run the refusal road with no declared error
ord: 5
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/http/retired.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/operations/registry.ts
    symbol: REGISTRY_OPERATIONS
  - kind: symbol
    ref: apps/tagma/server/src/providers/contract/wire/operations.ts
    symbol: PROVIDER_OPERATIONS
---
`GET /api/projects` (list) and `GET /api/accounts/cache-lifetime` declare no `error` in the door, but both handlers run through `answering` — the refusal road. A refusal from either travels outside the declared contract: untyped on the wire, unhandled by a client built from the declaration. Claim [[053d5c6c]] pins the behavior.

Done when both endpoints declare the error their handlers can raise, or both handlers are made infallible — with an owner decision stating which.