---
id: 01a13f4e-acb1-70b6-b095-9e3a9ceaf79c
title: Fit the app agents integration into the CPU budget or move the assembly check to the system layer
ord: 12
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13dcf-befa-7092-b69c-20473c961b0c
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/plugins/agents.itest.ts
---
`bun test --parallel=1 ./apps/tagma/server/src/composition/testing/plugins/agents.itest.ts` on 2026-10-15: 3 tests passed, but test/layers reported 12,685 ms CPU against an integration ceiling of 8,000 ms. The file holds the assembled server, a real app process, and its restart check; the world is already one per file in beforeAll. Let the test-layer owner choose the minimal sufficient check of the app-ending delivery contract: speed up the fixture or move the assembled-product check to `*.stest.ts`, keeping at-least-once on restart. Done when the checks keep the contract and fit their layer's budget; the cause of the overrun by this exact threads port is undetermined.
