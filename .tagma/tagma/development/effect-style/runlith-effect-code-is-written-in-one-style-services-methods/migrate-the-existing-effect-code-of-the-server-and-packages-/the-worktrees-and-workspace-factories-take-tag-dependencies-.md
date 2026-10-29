---
id: 01a13c10-e4a5-7ebd-9998-94ed6f17f315
title: The worktrees and workspace factories take tag dependencies through yield* in make, not as a synchronous record from assembly
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c96-629f-79f9-a4bc-2d234e722c25",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/workspace
  - kind: dir
    ref: apps/tagma/server/src/worktrees
---
workspace migrates to yield* at once within ea4edbe3; worktrees and the `threadRecords`/`threadFolders` factories (`thread-record/layer.ts`, `folders.ts`, with their test callers — `threads/recap/schedule.itest.ts`, `workspace/testing/lineage.ts`, `composition/testing/threads/folders.itest.ts`, `recordsOver`) remain here. In the migration (58efb370d8 and the workspace migration) the classes became synchronous `makeX({...})` into whose record the assembly (`assembly`/`layer`) puts already obtained services. The `effect4` skill requires: a tag dependency is `yield* Tag` inside `make`, only non-tag inputs arrive as a record; a synchronous factory is allowed only when it needs neither a resource nor a tag at creation. Behaviour does not change; assembly changes: each such factory becomes a `make` (Effect.fnUntraced), takes its tags itself, the layer builds it through `Layer.effect`. In the same pass remove migration boilerplate: a member's signature is written once (tag or generator parameters), with no `const x: (…) => Effect<…>` annotation over `Effect.fn`; dependencies by name, no `given.x` (example — `workspace/roots/uses.ts`). The modules' code after this is shorter than before the migration. Found by the worktrees migration's lead reviewer (P2). Proof is worktrees/workspace factories with no tags in the input record, module typecheck and tests green, spans preserved.
