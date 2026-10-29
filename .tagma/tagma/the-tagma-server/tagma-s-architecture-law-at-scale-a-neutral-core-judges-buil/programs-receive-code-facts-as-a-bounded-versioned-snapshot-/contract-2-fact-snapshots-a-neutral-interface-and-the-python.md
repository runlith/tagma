---
id: 01a0f747-1fc0-7e2d-8415-cb31b3583d0a
title: Contract 2 fact snapshots, a neutral interface, and the Python adapter
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f746-df34-7e3a-a2b4-b59706a3f794",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f476-0510-7432-a96e-1bbc3f3fe425
sources:
  - kind: dir
    ref: packages/code-facts/src/languages/py
  - kind: file
    ref: apps/tagma/inspection/src/core/program.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/facts.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/facts.ts
  - kind: file
    ref: packages/code-facts/src/adapter.ts
---
Implement §9 of the decision in packages/code-facts, apps/tagma/inspection/src/core/program.ts and apps/tagma/server/src/enforcement: snapshots of both sides' requested facts with versions, completeness, and refusal past the budget; a neutral interface keeping the JS-specific consumers; then Python for the src/<pkg>/{domain,app,adapters,api} layout. Acceptance: the contract program receives the allowed imports with no parsing of its own; the budget refuses with the needed size; boundaries judges Python and marks dynamic imports unjudged; type checks, contract tests and an independent review; adapter-area claims and resolution rewritten from the code. Go and Rust are out of scope.
