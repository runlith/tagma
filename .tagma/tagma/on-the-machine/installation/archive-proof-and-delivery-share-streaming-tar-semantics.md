---
id: 01a1a25d-a9f2-7725-8120-8f2692a9af4d
title: Archive proof and delivery share streaming tar semantics
ord: 75
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13283-fc95-76c8-a601-3f5eac2d9a04
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/archive/tarball.ts
---
Proof and delivery use one tar decoder so the archive's names and sizes cannot be interpreted differently before extraction. File contents stream without accumulating a listing; extended metadata has a bounded inspection buffer because compressed metadata can otherwise consume arbitrary memory. Sparse layouts are refused because an ordinary file-size sum does not describe their extraction footprint.