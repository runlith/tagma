---
id: 01a16190-8c9a-7c35-9e7e-98c57c50fada
title: TypeScript navigation
ord: 25
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/launcher.ts"
      }
    ],
    "id": "@runlith/navigation-ts",
    "kind": "kit",
    "order": [
      [
        "src/wire.ts",
        "src/memory.ts"
      ],
      [
        "src/engine/syntax.ts"
      ],
      [
        "src/engine/view.ts"
      ],
      [
        "src/engine/semantics.ts"
      ],
      [
        "src/engine/checkout.ts",
        "src/engine/quiet.ts"
      ],
      [
        "src/engine/held.ts"
      ],
      [
        "src/engine/workspace.ts"
      ],
      [
        "src/engineProcess.ts"
      ],
      [
        "src/launcher.ts"
      ]
    ]
  }
edges:
  - kind: imports
    to: 01a0c6ef-8083-763c-a499-dea0ffc6963b
  - kind: imports
    to: 01a16166-1402-7837-8a74-f7f8411a495f
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/navigation-ts
---
Navigation answers on TypeScript code with a verdict per occurrence only through a running compiler, and it is heavy and must not live on the server event loop. The module owns the repository's engine process — the `typescript/async` client and a child `tsc --api` in it — with snapshots of the base checkout and worktrees as layers of their differences from the base, their warm-up and holding, process memory, verdict semantics (place kind, function, alias, `['Service']` rule, degraded-project recognition), and the `Launcher` with which the holder opens such a process and talks to it over NDJSON. When to start the engine, what memory and CPU budget it gets, and what to do with its answer are decided by the holder and the navigation kit.
