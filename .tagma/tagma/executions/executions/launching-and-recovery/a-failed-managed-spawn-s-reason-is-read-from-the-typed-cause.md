---
id: 01a0c71c-6411-77fb-939d-2b83e8709647
title: A failed managed spawn's reason is read from the typed cause, not from the message
ord: 8
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/executionSpawner.ts
  - kind: file
    ref: packages/executions/src/ManagedCall.ts
  - kind: symbol
    ref: packages/executions/src/executionSpawner.ts
    symbol: failed
  - kind: symbol
    ref: packages/executions/src/ManagedCall.ts
    symbol: ManagedCallFailed
---
PlatformError carries cause: ManagedCallFailed; match cause.reason (`cancelled | refused | uncertain | unavailable`) — message and detail are for the person.
