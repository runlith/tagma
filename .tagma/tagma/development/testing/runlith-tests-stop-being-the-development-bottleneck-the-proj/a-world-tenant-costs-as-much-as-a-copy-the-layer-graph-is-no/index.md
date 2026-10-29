---
id: 01a16af5-72c5-7950-b64c-533614455f40
title: "A world tenant costs as much as a copy: the layer graph is not rebuilt per test, and a project is born cheaper at the producer or from a template"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/doorFixture.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graphFixture.ts
---
**Why separate.** A world on a worker removes a file's one-time price, but the ×20 goal runs into the per-test price. At ~0.04 s CPU per test all together (the parent spec) a tenant must cost markedly less, while today:
- every `withDemo` rebuilds the whole layer graph — `fixtureGraph`, store, units, watcher (`graphFixture.ts:348-391`, `building`): 0.08–0.11 s of its own process plus the SQLite children of that opening;
- a runtime-world tenant is `stealthProject` (`doorFixture.ts:170-178`): the product's `git init` and `add_project`, 1.0 s of its own process CPU, with the product's git (`graph/tree/shadow.ts`) on top.

**The graph world.** The layer graph builds once per world; a tenant is fresh data under it, not new services: a store copy into the already-open storage, or a new project in the same graph, whichever is cheaper at the same data isolation. Which services hold state between tests (caches, observers, pools) is found at build time and reset at the owner, not by rebuilding.

**The runtime world.** First the `add_project` profile in the runtime world: which share is product JS, which git and SQLite. Then two paths, by profile:
- cheaper birth at the producer ([[2393aff1]]) — then faster for the user adding a project too;
- a template of an already-born project (store lines, `graph.git`, the tree), handed out by copy — when the price sits in work the user pays once and the test need not repeat.

A test whose subject is the project's birth itself births it the real way.

**Acceptance.**
- The run report shows the per-test tenant acquisition price by world kind, before and after.
- The graph-world tenant spawns no SQLite processes and rebuilds no layer graph: the report shows 0 builds per test.
- The `add_project` profile recorded; the chosen path and its number recorded under this spec; when the producer path is chosen — the product's project-add time measured before and after.
