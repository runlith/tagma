---
id: 01a0c714-c5e3-79a9-a6ba-0ef704d2c08a
title: The host delivers events only within the credit its reader issued, and each delivery spends its whole frame
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/wire.ts
  - kind: symbol
    ref: packages/executions/src/protocol/wire.ts
    symbol: ClientMessage
  - kind: symbol
    ref: packages/executions/src/protocol/wire.ts
    symbol: Event
  - kind: symbol
    ref: packages/executions/src/protocol/wire.ts
    symbol: WireLimits
---
The reader returns credit in exactly the bytes it received, so the credit balance is the reader's bound on what the host may have in flight.