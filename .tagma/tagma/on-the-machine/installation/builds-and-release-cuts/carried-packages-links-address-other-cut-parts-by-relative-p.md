---
id: 01a1240e-e26c-703e-bef3-d5347c6396e2
title: Carried packages' links address other cut parts by relative path
ord: 5
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/installation/cut/packages.ts
    symbol: carryPackages
---
The Bun store may add absolute self-links and links between packages, so byte-for-byte copying of the directory preserves the dependency on the checkout. Package carrying resolves the source target by the carried set's physical roots and writes a relative link to its place in the cut; a target outside the set or a nonexistent target aborts the package step. That way links survive checkout deletion and the cut's own relocation, and the closure check keeps its previous boundary.
