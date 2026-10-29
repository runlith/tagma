---
id: 01a16bfb-221e-797e-8fd0-0a9f916950e3
title: A layer-offered driver starts after the serving stack assembly in that layer's scope and context; outside makeRuntime — at once
ord: 23
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/drives.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/drives.ts
---
A module names a driver in its manifest (`drivers: [{ id }]`) and offers a pass via `drive(id, pass)` instead of `Effect.forkScoped`. `makeRuntime` holds offers until the serving stack assembly ends and starts those selected by the `drivers` option (unset — all, `[]` — none). An offer after startup — from a layer assembled later, e.g. `AFTER_RECOVERY` — starts at once. An id in no manifest dies at offer time: otherwise an undeclared driver would neither be selected nor switched off.

The pass runs in the offering layer's scope and with its context, not `makeRuntime`'s context. So it closes with its layer, and the tracer, phase observers, and other layer references stay with it. A deferred start equals the old `forkScoped` in the same spot, only later. A pass failure is logged as a warning with the driver id.

`Drives` is a `Context.Reference`: a layer assembled outside `makeRuntime` (a module unit fixture) starts the pass at once, as before drivers existed. Fixtures therefore provide nothing.

A driver is a maintenance pass: sweep, retention, warmup, cadence retries. A subscription without which a service's response is wrong, and startup recovery that responses stand on, stay in layers. A world with drivers switched off must answer the same, not catch up more slowly.
