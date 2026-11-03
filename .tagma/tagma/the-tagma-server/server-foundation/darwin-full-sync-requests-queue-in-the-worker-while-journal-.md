---
id: 01a1a24d-752a-79e0-afa6-c83fe2578129
title: Darwin full-sync requests queue in the worker while journal lanes stay held
ord: 47
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/durable/flush.ts
  - kind: file
    ref: apps/tagma/server/src/platform/durable/flush.worker.ts
---
A full-sync is leaf I/O: its worker completes without acquiring a resource held by the caller. Independent journal exports can therefore retain their own lanes while awaiting the worker's serialized replies; treating this wait as another held-capacity acquisition would falsely fail concurrent durable writes.