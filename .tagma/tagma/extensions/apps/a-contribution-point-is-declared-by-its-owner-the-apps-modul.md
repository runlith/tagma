---
id: 01a12320-6df6-76cb-a826-b1be7d2dc40e
title: A contribution point is declared by its owner; the apps module only checks the declaration and registers it per process generation
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12306-efba-7a0e-94d7-05ecc0602266
sources:
  - kind: file
    ref: apps/tagma/server/src/tagma-apps/contract/service/points.ts
  - kind: file
    ref: apps/tagma/server/src/tagma-apps/registry.ts
---
A contribution point belongs to the owner of what the app writes into, not to the `tagma-apps` module: the next capability is added as a new point at its own owner, with no edits to the envelope or the supervisor. The owner declares the point through `TagmaAppPoints.declare` when assembling its layer: the schema, the keys the contribution occupies (`claims` — two apps on one key give a refusal naming the holder), and the `register` returning a disposer. Keys are taken in one synchronous step before the first `register`, so two apps checked at once do not take one key.

Declarations must stand before the first manifest read: composition calls `TagmaApps.start` after assembling the whole runtime, when the HTTP door already listens. A point nobody declared is a refusal with its name; nothing is silently lost.

`register` takes the contribution anew on every process generation: the tools this process hands over, and the caller going through the supervisor: during a restart it waits for the new process, and during backoff after a crash it refuses at once. Project visibility (`apps.enabled`) is filtered by the point owner itself: registration is shared per machine, like the process.
