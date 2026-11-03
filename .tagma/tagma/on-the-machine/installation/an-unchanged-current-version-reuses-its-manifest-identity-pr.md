---
id: 01a1a260-d58e-7fa6-b1d5-c6687b52a857
title: An unchanged current version reuses its manifest identity proof
ord: 76
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/closure/current.ts
  - kind: file
    ref: apps/tagma/server/src/installation/closure/manifests.ts
  - kind: file
    ref: apps/tagma/server/src/installation/closure/proof.ts
  - kind: file
    ref: apps/tagma/server/src/installation/closure/proof.worker.ts
---
The closure owner keys its current projection by the resolved version and the manifest's file identity, size, modification and change timestamps. It reads the canonical version and checks the revision again before publishing, so switching the current link during proof cannot attach another version's manifest to the old key. Full part verification stays separate: filesystem adapters supply bounded chunks to the installation proof worker, which owns manifest identity computation and incremental content hashing.