---
id: 01a0e532-cd6e-7a04-85b9-0ab5dd5ad950
title: "http M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0eaeb-8280-79e2-834d-8efa354b0c0d",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-cd64-7768-8533-d82bcb39fb3f
---
§7.2.2 milestone `M2` of the `http` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

Divergence: `http/operationBinding.ts` stays in http rather than moving to invocation, because it reads `api/Caller.ts`'s HTTP tags, which sit above invocation's floor; `HttpOwners`, `HttpOperationFileOwners` and `ThreadDoorOwners` dissolved in place, and the typed route groups of threads, native-harness, external-harnesses, worktrees and executions stand as debt on [[29ce4645]], [[4047bdcd]], [[36bb8530]], [[191594cc]] and [[11f1e38f]], so `HttpCallerWorld`/`CallerMiddleware` retire with them.