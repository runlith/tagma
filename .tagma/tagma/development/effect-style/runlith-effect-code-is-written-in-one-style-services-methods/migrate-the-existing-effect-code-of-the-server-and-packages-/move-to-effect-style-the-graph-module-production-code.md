---
id: 01a13c96-169d-7590-9735-bcaf64ef0ba3
title: "Move to Effect style: the graph module production code"
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c96-629f-79f9-a4bc-2d25b2ec4f97",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph
---
The production code of `apps/tagma/server/src/graph` and the tests of the files being changed follow the `effect4` skill. The module's remaining ~460 test sites on `runPromise` are a separate task. Proof is zero effect-style findings for the module production, module typecheck and tests green, spans preserved.

Unproven: two ea465bed debt sites (`declarationOf.part`, `layers.textOf`) stayed behind [[efc6a9fe]]; `titlesStealth.itest` and the `rankingMatrix`/`history` itests fail under machine load — [[739eae0c]], [[ae741f83]]; the `&&` shape in the swallowed-failures check — [[5a61c757]].
