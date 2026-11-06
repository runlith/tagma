---
id: 01a1aebd-c391-799c-8316-5cdec6ac0835
title: An act settles a team project's stealth layer before its .tagma tree
ord: 32
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/stealth.ts
    symbol: actingTrees
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/stealth.ts
    symbol: servedStealth
---
A block moved from stealth to team reaches another checkout in two halves: the code merge brings its team file, and the layer's twin merge — due once that checkout's HEAD took the branch — removes its stealth copy. Settling the layer first lets a due twin merge run before the team tree reads the arrival; the other order read both copies on disk and refused `duplicate-identity`, so the act never reached the layer's topology. The reverse move needs no order: the code merge has already removed the team file from disk, and identity is checked against files on disk.