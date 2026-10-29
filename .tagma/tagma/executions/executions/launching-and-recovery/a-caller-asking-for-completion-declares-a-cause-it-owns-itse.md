---
id: 01a0c704-c9f0-78e4-93e9-124ed85882bc
title: A caller asking for completion declares a cause it owns itself, not one the host makes for itself
ord: 3
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/call.ts
  - kind: file
    ref: packages/executions/src/protocol/stop.ts
  - kind: symbol
    ref: packages/executions/src/protocol/call.ts
    symbol: CancellationCause
  - kind: symbol
    ref: packages/executions/src/protocol/call.ts
    symbol: DeclaredCancellationCause
---
Only the host declares `not-started`, for taken work with no child. The caller's request decodes as `DeclaredCancellationCause`; the port and the wire frame take the whole union.
