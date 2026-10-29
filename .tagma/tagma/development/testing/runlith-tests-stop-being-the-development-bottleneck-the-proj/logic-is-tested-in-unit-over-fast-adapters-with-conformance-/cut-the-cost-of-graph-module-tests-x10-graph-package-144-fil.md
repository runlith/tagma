---
id: 01a16dee-7998-74dc-8c85-ee78ea217606
title: "Cut the cost of graph module tests: x10/graph package (144 files, 342 s CPU before)"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16a94-8d3a-7610-abd9-8503665bc41f",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Tests of `apps/tagma/server/src/graph` and `apps/tagma/server/src/composition/testing/graph` per the [[4dbd9a84]] outcomes: deletion, logic to unit, merge, narrow itest. The graph module's git port with an in-memory adapter — where the analysis shows logic is checked through a world with git. Ledger: `x10/x-graph.tsv` in the orchestrator's scratch. **Result.** Test cuts in 8 files (83.8 s CPU before, quiet measurement 08f81bea): `idleCopies` — 2 full runtime starts instead of 3; `vocabularyFormat` — 2 tenants and pools instead of 5; `servingDrill` — one mirror rebuild per test instead of two; `folder` — no repeated team↔stealth transition; `neutrality` — removed covered case (`http/projectCatalogs.itest`, `vocabulary/profile.test`); `routing`, `machineWriter`, `concurrencyDrill` — one fewer test on the shared pool. "After" numbers taken under load ~25 and not comparable with "before". Product git cuts: `core.excludesFile` read by one owner (`platform/git/excludes.ts`), and tree freshness rereads it only when the repository's stat config changes; `Mirrors.identify` — one `rev-parse` instead of two per open. Remaining files are the module's real git or SQL, outcome "keep" with the reason in the ledger.
