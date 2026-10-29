---
id: 01a13d67-6a51-7a60-95a6-c9f54c66fb19
title: Migrate the execution host store and registry to Effect shape, keeping wire projections and scopes
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d2f-a3e1-7eb6-b786-be39dc244afb",
    "status": "done"
  }
sources:
  - kind: dir
    ref: packages/execution-host/src/registry
  - kind: dir
    ref: packages/execution-host/src/store
---
Migrate `packages/execution-host/src/store/` and `src/registry/` to `effect4` shape: internal errors are `Data.TaggedError`, reusable Effect functions are `Effect.fn`/`fnUntraced`, previous spans and resource bounds stay. Also remove the `return Effect.gen(...)` wrappers the checker misses after destructuring. Proof: effect-style 0 for both directories, clean check_law, typecheck and the store, custody, retention, inventory, adoption, shutdown and handover checks; an independent review. Commit after the parent reviews the diff.
