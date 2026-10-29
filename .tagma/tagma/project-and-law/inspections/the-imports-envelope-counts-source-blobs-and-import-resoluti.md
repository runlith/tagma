---
id: 01a12981-42e6-7f1c-a6db-3a84764e6ba1
title: The imports envelope counts source blobs, and import resolution depends on the tree and policy
ord: 21
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/probes.ts
---
Blob identity measures source-text volume, not the number of import resolutions or worker memory: bytes are charged once, each source probe counted separately. Viewed glob candidates also spend the file envelope: a short pattern can unfold into many edges without much source text. That does not make edges shared: a manifest or path set can change the same specifier's resolution. The stored importer index is bound to the resolution policy, territory and tree snapshot, and rows that read an installed package are also bound to its fingerprint ([[edd30011]]). Entries, relations and order change access to already-resolved edges and preserve the index; a package export invalidates only the used binding, and a new wildcard overlap also touches prior users. Cold reading serves narrowing access without a recoverable index; widening access needs no violation search among unchanged consumers.
