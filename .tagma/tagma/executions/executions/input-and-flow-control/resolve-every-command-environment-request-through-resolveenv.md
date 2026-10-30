---
id: 01a0c72b-21da-7fdb-ad44-d5963b569dd7
title: Resolve every command environment request through `resolveEnvironment`
ord: 6
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/CommandEnvironment.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/worlds/managed.ts
    symbol: processEnvironment
  - kind: symbol
    ref: apps/tagma/server/src/workspaces/HostEnvironment.ts
    symbol: BoundEnvironment
  - kind: symbol
    ref: packages/executions/src/CommandEnvironment.ts
    symbol: resolveEnvironment
---
One request has one value; entries apply in order, not as a set.