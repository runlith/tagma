---
id: 01a17920-2246-7f0e-ad5b-f92269048324
title: "Law on subtree moves: the inspection key in the target, debt with its owner in one graph, both projects' module cards"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1790d-c718-7101-b25d-b9da9c7cf162",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1791f-3e3a-7001-8f34-c91e7840a792
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/relocation.ts
---
Do per [[7840a792]]: the graph reads the project law through the `ProjectLaw` port, filled by enforcement; the move refuses before writing if a running rule's inspection key is undeclared in the target, if debt diverges from its owner across graphs, or if either project's module map stops holding.
