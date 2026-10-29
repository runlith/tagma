---
id: 01a15246-8429-7cb3-afbe-1edc450375ea
title: Fit project-registration and graph-freshness integration suites into the CPU budget
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-a858-74a6-80bc-abc30183c034",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1520d-63b9-715d-92db-df3621d412fb
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.itest.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/projects.itest.ts
---
On run `108c7a39-e328-4ca1-a748-23f3f2975260:167` all 16 tests are green, but `projects.itest.ts` spent 8689 ms CPU, `freshness.itest.ts` 14458 ms at an 8000 ms budget per file; a rerun without the parallel typecheck ruled out its contention as a sufficient explanation. Done (43fdabaffd): `freshness.itest.ts` is split by subject without changing the tests: health and sibling-copy recovery (`freshness.itest.ts`), live-tree refresh and re-observation (`treeRefresh.itest.ts`), reading from a changed mark (`treeMarks.itest.ts`); the shared `servedTree` is `composition/testing/servedTree.fixture.ts`. Measurement with `RUNLITH_TEST_REPORT` per file, CPU: freshness 4.0–6.7 s, treeRefresh 4.2 s, treeMarks 4.4 s, projects 3.9–4.5 s (unchanged: the earlier 8.7 s was taken under load). Each suite's price is about 90 git runs per test in stealth-tree opening (`rev-parse --abbrev-ref HEAD`, `for-each-ref`, `worktree list` repeat); shrinking them at topology is separate work if needed.

Speed up the fixture or split independent contracts, and move tests that truly need an assembled system into the system layer; timeouts and budgets are not extended. Each resulting file needs its layer's measurement and preservation of registration, path, topology and observation checks.
