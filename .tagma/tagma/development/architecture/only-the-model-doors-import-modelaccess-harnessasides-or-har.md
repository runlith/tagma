---
id: 01a18d50-f2c0-700f-86f0-c72a93f04f23
title: Only the model doors import ModelAccess, HarnessAsides or harness rows; every other server file asks through ModelAsks and ThreadAsks
ord: 26
tags: ["rule"]
edges:
  - kind: relates
    to: 01a18cbf-9775-75eb-a4a1-6542bcec10b7
sources:
  - kind: file
    ref: apps/tagma/server/src/providers/contract/service/access.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/service/asides.ts
---
The doors are these:
- `ModelAccess` — `providers`, the native chat turn (`native-harness/kernel.ts`, `native-harness/assembly.ts`), `threads/asks.ts` and `composition`;
- `HarnessAsides` — `threads/asks.ts` and `composition`;
- harness rows — `external-harnesses` and `threads/harness`.

A new feature that needs a model answer asks through a door and never joins this list.