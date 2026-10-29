---
id: 01a0c8cb-047a-7956-b3dc-cdbda058a6e5
title: A saved thread whose model's switch was retired fails its next call instead of opening without it
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: packages/llm/src/models/resolve.ts
    symbol: resolveModelCall
---
`resolve.ts:114-120` throws `Switch "X" is not configured` for any id the row does not declare. `chosenSwitches` at `:149` would drop an undeclared id, but it runs strictly after the throw and is module-private, so the drop is dead in-repo. A stored thread's set rides the same `input.switches` field a caller's does — `ThreadTurnRunner.ts:410` into `ModelRequests.ts:47` — and `AccountDefaults.ts:30-34` explicitly delegates stored-set filtering to "where the call is resolved", which is the door that refuses. Two layers each believe the other filters.

Four comments document the behaviour that does not exist: `resolve.ts:65-69`, `:111-113`, `:147-148` and `description.ts:42-46`.

Decide: delete the dead drop, or narrow the refuse loop to caller-supplied selections. The claim [[cf415ff4]] states what the code does today.