---
id: 01a0e99a-f91a-7adb-9a0d-6f964fe9507f
title: The `modules` builtin judges an import of a built workspace package, such as window-behavior's `dist/` exports, instead of refusing it as unresolved
ord: 38
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e569-e6f2-786f-8d96-e265c5690784
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/implementation.ts
---
`@runlith/window-behavior`'s `exports` point at `dist/`, which is gitignored, so the `modules` builtin reading a commit finds no file and reports `@tagma/desktop -> @runlith/window-behavior/… unresolved` for the three imports in `apps/tagma/desktop/src/main.ts`. The `platforms` builtin already carries a `built` list for such packages; `modules` has none. Done when an import of a built package's entry resolves to the module that owns it (through its sources or a declared `built` mapping) and the three debt entries in `checks/modules.server.debt.json` owned by this task retire.