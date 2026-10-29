---
id: 01a13b48-b2a2-7d3d-be03-ef7abfed53d4
title: "Three scopes built with Effect.runSync(Scope.make()) never close: their owners' finalizers never run"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13b9a-e731-7377-a05a-5cc3aa50411b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13b37-5351-7e3a-bda9-f7c22e414755
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/viewLeases.ts
  - kind: file
    ref: apps/tagma/server/src/executions/worlds/cache.ts
  - kind: file
    ref: packages/llm/src/models/client.ts
---
`LeasedWorlds.opening` (`executions/worlds/cache.ts:42`) and `ViewLeaseBook.turns` (`executions/terminals/viewLeases.ts:28`) build `flight`/`waiters` in a field initializer under `Effect.runSync(Scope.make())`; `openModelClient` (`packages/llm/src/models/client.ts:10`) builds the client layer under `Scope.makeUnsafe()`. No scope ever closes, so these mechanisms' finalizers never run. All three owners live as long as the process (call sites: `executions/assembly.ts`, `providers/access.ts:21`, `packages/agent/src/agent/ModelRequests.ts:46`), so the leak is small, but it is a defect.

Fix: the scope is taken from the layer owning the object and closes with it. The passing shape (constructor parameter or `make`) follows the [[cb27ea54|classes-and-closures]] decision. Proof is a module test that closes the layer and observes the executed finalizer.
