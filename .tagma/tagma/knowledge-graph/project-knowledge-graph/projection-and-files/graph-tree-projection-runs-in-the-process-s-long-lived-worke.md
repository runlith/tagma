---
id: 01a17bef-ab31-7055-af43-758e5b07b19e
title: "Graph-tree projection runs in the process's long-lived workers, in lanes: a worker per call paid a cold start costlier than the projection itself"
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16af5-72c5-7950-b64c-533614455f40
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/projection.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/projection.worker.ts
---
Projecting rows into block files runs off the event loop ([[7a910861|the rule on unbounded computation]]), and a worker per call paid its own cold start: loading effect and the export modules. For a new project's tree — directories and a root, a dozen blocks — the start cost many times the projection itself, and every project birth paid it (a serving switch or a birth straight into the tree), every bringing of the tree by graph steps, and every `rewrite_graph_files`.

So projection is held by the process's long-lived workers through `workerLink`, no more than three lanes and no more than the core count minus one. A job goes to the lane with fewest waiters, so without parallel projections only the first lane lives and starts; the next lane's worker rises only when projections truly run in parallel — otherwise opening many projects after a new graph step would line up in one queue. An idle worker holds no process.

A job's defect is caught by the worker on its own message, and only that job is answered with a refusal: otherwise the exception would take the worker down together with other projects' waiting projections. If the worker still falls, `workerLink` answers every waiter of its lane with a refusal, and the next call raises a new one.

The price of the choice is up to three extra isolates with export modules in the process memory after the first projection on each lane. A one-shot worker stays where memory matters: parsing symbol-source declarations ([[5d41f0fa]]) loads parsers tens of megabytes large, and keeping them resident costs more than starting a worker for each new place.
