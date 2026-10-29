---
id: 01a13d2f-397e-77cc-90c3-6f03bdb21bcd
title: "Move to Effect style: the execution-host and executions packages"
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c17-b1ed-7b23-864a-44198f63889a",
    "status": "done"
  }
sources:
  - kind: dir
    ref: packages/execution-host
  - kind: dir
    ref: packages/executions
---
The production code and tests of `packages/execution-host` and `packages/executions` follow the `effect4` skill. An error travelling the wire to the server stays a schema shape at the boundary's owner (rule 01ba3d55); an internal one is `Data.TaggedError`. Proof is zero effect-style findings for the packages, typecheck and tests green, spans preserved.
