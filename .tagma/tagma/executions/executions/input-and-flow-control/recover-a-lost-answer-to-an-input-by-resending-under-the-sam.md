---
id: 01a0c705-58fe-71de-8de4-877e274e6874
title: Recover a lost answer to an input by resending under the same sequence, never by sending the bytes again under a new one
ord: 2
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/protocol/input.ts
    symbol: InputAnswer
  - kind: symbol
    ref: packages/executions/src/protocol/input.ts
    symbol: InputReceipt
---
The same sequence answers with the earlier receipt; other bytes under it are rejected. A sequence below the storage window answers `expired` instead of acting again.