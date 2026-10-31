---
id: 01a19307-a9c8-74b4-8508-239e17d58c63
title: Stop admission and conditional prevention arbitrate the key before any stop effect
ord: 14
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/store/endings.ts
  - kind: file
    ref: packages/execution-host/src/registry/stops.ts
  - kind: file
    ref: packages/execution-host/src/registry/operations.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/reads.ts
---
A cancelled wire waiter does not cancel the host's already-delivered work, so an empty key lookup proves no absence. Stop admission and prevention serialize through the same stored key: prevention takes a durable tombstone, while an admitted stop keeps it taken before queued, orphan, call or native effects; an admission write failure performs none of those effects. Stop-intent rows also cover legacy admissions and multi-execution sweeps, whose one key must remain usable across their covered executions.