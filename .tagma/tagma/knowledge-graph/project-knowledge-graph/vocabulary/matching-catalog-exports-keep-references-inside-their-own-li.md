---
id: 01a1483a-9fca-796b-825c-4f33f54f0990
title: Matching catalog exports keep references inside their own library
ord: 3
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/vocabulary/candidate.ts
    symbol: settleCatalog
  - kind: symbol
    ref: apps/tagma/server/src/graph/vocabulary/identity.ts
    symbol: Identities.assignKey
  - kind: symbol
    ref: apps/tagma/server/src/graph/vocabulary/layers.ts
    symbol: settle
---
The permanent id names the type, and the key assigned in the project names its storage. Inheritance and ref fields between one catalog's exports keep their library under taken short keys, including inside one install candidate: otherwise two independent vocabularies would be bound by a matched name. When comparing with the base, a short reference and its permanent id mean one type: the reference binding itself must not stop catalog updates as a local edit.
