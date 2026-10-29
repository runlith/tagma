---
id: 01a15a0b-f08f-7245-befa-c2fa4d6a14b0
title: The server loads the source parser onto the event loop through the symbol-source check, and the event loop test fails
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15a9e-e8f4-7e76-bab5-f651d6c30fe9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a159e7-85d5-71ad-9cb6-d4bcb495071b
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/eventLoop.itest.ts
  - kind: file
    ref: apps/tagma/server/src/graph/sources/declared.ts
---
**What.** `src/enforcement/eventLoop.itest.ts` ("the server and the CLI load no source parser on their event loop") fails: `composition/server.ts` loads `oxc-parser` and `typescript` through `graph/sources/declared.ts` → `declaredNames.ts` → `@runlith/code-facts/adapters`.

**Why.** `declared.ts` imports values from `declaredNames.ts` (`declaredAt`, `missingFile`) and judges files up to `ON_LOOP_BYTES` on the loop — decided so in [[5d41f0fa]]. The test requires that no parser loads into the server process. The decision and the test contradict each other; the failure was found while working on [[b495071b]] and does not belong to it.

**To decide.** Either declaration parsing moves to the worker whole (loading the parser in the main process is also a cost, not just the parsing itself), or the test gains an exception for this path with a reason. Then the test is green.
