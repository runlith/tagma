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
  - kind: file
    ref: apps/tagma/server/src/installation/archive/materialize.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/archive.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/archive.worker.ts
---
Proof, delivery inspection and materialization use one tar decoder so names and sizes cannot change meaning between the footprint check and extraction. File contents stream without accumulating a listing; extended metadata has a bounded inspection buffer because compressed metadata can otherwise consume arbitrary memory. Sparse layouts are refused because an ordinary file-size sum does not describe their extraction footprint. Materialization restores file contents, ordinary modes and internal links into new files, leaving archived owners, extended attributes, ACLs and file flags unapplied. Its worker is joined before staging cleanup: cancellation aborts the input stream and waits for the remote operation to release its files.