---
id: 01a13fcf-78eb-70b7-b325-3b15ec522548
title: "Opening a new project's graph costs seconds: the tree is projected twice, the empty tree is scanned"
ord: 51
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13fd0-aafb-7c4c-bb78-cce3611ba91a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f2d-638d-74e9-8a14-33acd1cc7192
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph/serving
---
Registering a new project (`add_project`) costs 7.2 s, of which `GraphPool.open` is 5.9 s; SQL is only 1.2 s wall (378 `sql.execute`). One registration measured in a door fixture, trace 706/706 spans, machine under load (one sample).

Large steps inside `GraphPool.open`:
- `Graph.advanceTree` 1854 ms, inside it a second `Graph.projectToTree` 382 ms;
- `project.birth` 1107 ms;
- `Graph.scanTree` 880 ms;
- `Graph.projectToTree` 708 ms;
- `Graph.treeHoldsAny` 708 ms;
- `installCatalogs` 671 ms;
- `FreshnessGate.settled` 506 ms.

Suspicions to verify against the code:
- the tree is projected twice in one opening (`projectToTree` and again inside `advanceTree`);
- `scanTree` and `treeHoldsAny` run for a just-created, known-empty tree;
- the cost grows from shadow-tree git processes, not SQL.

Goal: opening a new project's graph costs what it holds — an empty project opens in fractions of a second; every step runs once. Proof: the breakdown of the same registration before and after, the same fixture; green graph-serving tests.

Found while translating the composition testing http (door fixture: build 19.9 s, hook-timeout 10 s).
