---
id: 01a0c71c-6411-77fb-939d-2b83e8709647
title: Read why a managed spawn failed from the typed cause, never from the message
ord: 8
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/ManagedCall.ts
    symbol: ManagedCallFailed
---
`PlatformError` carries `cause: ManagedCallFailed`; match `cause.reason` (`cancelled | refused | uncertain | unavailable`). Message and detail are for the person.