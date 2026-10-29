---
id: 01a12d1d-7e00-774b-b369-ee0e8e376024
title: An incremental map judgment's footprint includes not-yet-found importers
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12d0b-36c5-749e-b5a9-4aaa3a13480f
sources:
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/rules/enforce.ts
    symbol: staleUnder
---
Checked files and the freshness footprint are different sets: after prepare an existing file can become a new importer of a closing entry, and a stored probe can depend on a config outside `base`. The map court passes the region footprint and resolver inputs apart from actually read sources; execute compares the HEAD delta against it so a warm index can't record a narrowing on the old importer set.
