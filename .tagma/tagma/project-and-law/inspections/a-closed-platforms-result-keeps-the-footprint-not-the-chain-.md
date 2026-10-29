---
id: 01a132d4-764e-7e17-af1b-8f5613d6941a
title: A closed platforms result keeps the footprint, not the chain of intermediate memos
ord: 26
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/records.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/starts.ts
  - kind: file
    ref: apps/tagma/inspection/src/packs/js/platforms/walk.ts
---
A package's contribution already holds finished violations, so its validity can be checked against the full footprint: the affected packages' trees, external files, listings, workspace composition, and the installed-file fingerprints through which aliases resolved. Fingerprints never fold into the package tree holding their `node_modules`: reinstalling them does not change that tree. Replacing many internal dependencies with the package fingerprint is conservative: a stray edit triggers recompute, while a foreign dependency change or a previously missing candidate appearing is never lost. Generated-copy freshness is verified before reading or producing these contributions: a mismatch is an inspection failure, never a cached unresolved source whose tree footprint cannot observe regeneration. This result's reader needs no intermediate entries, which the store may evict. When the dependency chain cannot be closed, the writer keeps no aggregate; the computed result stays the answer. Other memos' validity still requires their parents ([[c9731fc6|memo contract]]).
