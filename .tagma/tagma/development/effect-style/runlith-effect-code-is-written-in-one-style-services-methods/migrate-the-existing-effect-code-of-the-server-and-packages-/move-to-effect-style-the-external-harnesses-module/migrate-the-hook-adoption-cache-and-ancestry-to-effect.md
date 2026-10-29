---
id: 01a1400d-287d-724e-bf5f-93fa8e0a3383
title: Migrate the hook adoption cache and ancestry to Effect
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f16-3817-7139-a4eb-84cd102afa14",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f16-1128-7f09-9a38-ea1d23d2ccf0
  - kind: relates
    to: 01a128d2-01b7-7b48-9c20-d368c798d60b
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/adoption.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/testing/adoption.itest.ts
---
The first part of hooks/: migrate adoptedHook and the cache answer to Effect/FileSystem, decode the saved witness with an effectful Schema, own the ps process through scope; keep the job witness, shell binding, settled refusals and re-adoption into the same thread from the [[c798d60b|re-adoption invariant]]. Update only the direct forgetAdoption call and consumers' FS wiring, migrate adoption.itest and the nine direct hookWrites.itest scenarios to effect-test, prove ancestry-process cancellation. HookDelivery and the rest of dispatch are the next delivery. Before landing, to the parent: diff, production metrics, spans, one package typecheck, narrow tests, check_law and one independent review round.
