---
id: 01a1ae21-c3f7-7f79-8ad8-be0f15a9515f
title: "Each store keeps its own set-aside: mirrors of one project and stores of one directory no longer share a file per migration"
ord: 51
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a195b9-c52c-7da9-a023-4462899da1e8
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/ownStore.ts
---
`setAsidePath(storePath, migration)` keys a set-aside by the store's directory and the migration name alone. Every graph mirror of one project (`<data>/mirror/<project>/<hash>.sqlite`) runs the machine chain and writes the same `set-aside/<migration>.sqlite`, the last writer winning, and a step back hands that one file to every mirror, so mirror A could take mirror B's rows. The machine, activity and evidence stores likewise share `<data>/stores/set-aside/`. Latent while only calls_leave keeps tables, which are empty in mirrors. The layout change must keep the adoption the paid build's calls store makes through `setAsidePath(machine.path, migration)`. Done when two stores running one chain keep and get back their own rows.