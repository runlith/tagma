---
id: 01a12726-9e16-7f6a-a8a2-1530ab4f67c2
title: "Place graph: a project selector instead of global|tagma on graph operations, and reference search across all projects on the machine"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12726-f0e9-78a9-8213-81efb3ac43b4",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
  - kind: relates
    to: 01a12726-9e16-7f6a-a8a2-152f37d7c9ad
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/crossing.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/routing.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/selector.ts
---
The spec's "Graph" and "Project selector" sections.

Do: replace `globalProjectTarget` (`graph/contract/wire/operations/shared.ts`) with a selector: the name or id of any registered project, the `global` and `tagma` aliases (via `Reflections.homeProject`), an alias/name clash — `ambiguous-project`. Move every `input.project === 'global'` branch and `globalTarget` in `graph/operations` to `OtherGraphs`/`atTarget` from `crossing.ts`; there is no second mechanism. `titlesAcross` (`graph/serving/routing.ts`) also searches the remaining projects, keeping project and branch; an ambiguous short name is `ambiguous-name`, not first-match. A `parentId` from another graph under an explicit `project` is a refusal.

Admission untouched: the selector lives in graph operations' input, as `project` does today.

Done: integration test on two projects — create/search/batch with `project: B` write and read graph B; a reference to a B block resolves from A with the project; aliases work as before.
