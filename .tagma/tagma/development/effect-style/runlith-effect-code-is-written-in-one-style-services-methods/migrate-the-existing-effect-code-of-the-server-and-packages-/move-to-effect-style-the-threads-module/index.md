---
id: 01a13dcf-befa-7092-b69c-20473c961b0c
title: "Move to Effect style: the threads module"
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c17-df03-73aa-b4ae-e2cd5d28bddd",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/threads
---
The production code and tests of `apps/tagma/server/src/threads` follow the `effect4` skill. Proof is zero effect-style findings for the module, module typecheck and tests green, spans preserved.
