---
id: 01a0c99b-e464-751b-9ae6-2b61a2cac9a1
title: A workflow may call itself and nothing bounds the nesting, where the spawn tree refuses past a stated ceiling
ord: 136
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/workflow/engine.ts
  - kind: file
    ref: packages/agent/src/workflow/library.ts
  - kind: symbol
    ref: packages/agent/src/collaboration/ThreadSpawnAccess.ts
    symbol: ThreadSpawnAccess
---
A call step runs a named workflow as a run of its own under the same thread. The name is resolved through the library, which compiles every definition it holds against the vocabulary of names it holds — including the definition's own name. So a workflow may name itself, or name a second workflow that names it back, and it compiles.

At run time the engine opens the called run and drives it, and a call step inside that run opens another. Nothing counts the nesting: `depth`, `cycle` and `recursion` appear nowhere in the engine or the library. A definition that calls itself has no base case unless its own transitions provide one, and a pair that call each other cannot provide one at all.

This is not the same shape as the spawn tree, which bounds its children by a host-stated ceiling of one through five and refuses the birth past it. The workflow plane has the same recursion and no such bound, so the two planes disagree about a hazard they share.

The compile-time half and the run-time half can be answered separately. A cycle among call steps is detectable where a definition is compiled against the library's names, exactly as a cycle of unconditional transitions inside one definition already is — that check exists and stops at the definition's own edges. And a nesting ceiling at run time would catch what compilation cannot, since a name resolves to whatever revision stands when the call opens.

Done when a workflow that calls itself, directly or through another, either refuses at compilation or stops at a stated ceiling — and the claim over the call step says which.
