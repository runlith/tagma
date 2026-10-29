---
id: 01a0c705-58fe-71de-8de4-877e274e6874
title: A lost answer to an input is recovered under the sequence it was sent with, not by resending bytes
ord: 2
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/input.ts
  - kind: file
    ref: packages/executions/src/protocol/inputProfile.ts
  - kind: symbol
    ref: packages/executions/src/protocol/input.ts
    symbol: InputAnswer
  - kind: symbol
    ref: packages/executions/src/protocol/input.ts
    symbol: InputReceipt
---
The same sequence answers with the earlier receipt; other bytes under it are rejected. A sequence below the storage window answers expired, not with a new act.
