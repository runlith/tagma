---
id: 01a18d50-f2c0-700f-86f0-c72a93f04f23
title: "No server code asks a model outside the doors: only providers, the native chat turn and ThreadAsks call ModelAccess or an aside's ask"
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
A model answer outside a chat turn comes only through `ModelAsks` or `ThreadAsks`.
- `ModelAccess.request`, and the requests it returns, are called only in `providers` and in the native chat turn (`native-harness/kernel.ts`, `native-harness/assembly.ts`).
- An aside's `ask` is called only in `threads/asks.ts`.
- A harness row is read only in `external-harnesses` and `threads/harness`.

Importing these services to provide, publish, watch or clear them is not asking, and stays allowed. A new feature asks through a door and never joins these places.