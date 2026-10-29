---
id: 01a0caf1-fb26-7280-8ba3-0a28ebe739ed
title: A pack width authored in process is never held to the 64 ceiling the definition schema declares
ord: 134
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: packages/agent/src/workflow/compile.ts
    symbol: compileWorkflow
  - kind: symbol
    ref: packages/agent/src/workflow/definition.ts
    symbol: workflowCountSchema
  - kind: symbol
    ref: packages/agent/src/workflow/engine.ts
    symbol: packWidth
---
The 1..64 bound on a pack's count lives only in `workflowCountSchema`, so it binds a definition read from text through `parseWorkflowDefinition` and nothing else. `compileWorkflow` checks a plan's shape — reachability, held seams and conditions, barrier widths against declared counts — and never the width of a count, and `packWidth` returns a literal number untouched. A definition assembled through `WorkflowAuthor` and compiled directly therefore reaches the engine with whatever number it named, and the engine mints that many member ids.

The declared type does not catch it either: `WorkflowCount`'s number arm erases to `number`, so `{ count: 1000 }` typechecks.

Start at `packages/agent/src/workflow/compile.ts#compileWorkflow` and decide where the ceiling belongs — at compile, so every road into the engine passes it, or as an explicit statement that in-process authoring is trusted. Proof: a test that compiles an authored definition with a count above the ceiling and asserts the chosen behaviour, and [[b39be0b6]] rewritten to whatever the fix makes true.