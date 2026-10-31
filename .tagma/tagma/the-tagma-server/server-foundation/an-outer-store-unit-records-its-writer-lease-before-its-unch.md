---
id: 01a18f5e-76d6-72cc-93f4-b2bbc8bab01c
title: An outer Store unit records its writer lease before its unchanged post-commit work
ord: 37
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
  - kind: file
    ref: packages/sqlite-process/src/writerPermit.ts
  - kind: file
    ref: packages/sqlite-process/src/ProcessPool.ts
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/open.ts
---
A real Store closes over its shared SQLite process pool's writer collector at construction, so replacing the invoking service context cannot disable observations or redirect them into another collector. Mounting exposes that same collector and may supply a collector with its chosen retention bounds to the pool. The Store supplies one timing frame for each outer physical unit, including failed or interrupted attempts; same-store nested units share it. The SQLite permit binds the frame to its actual connection object before waiting, and only that connection may add wait, hold or child replies. An independent read on another writer is outside that unit's frame, while its resource cost still belongs to the causing root. Wait is the physical monotonic interval from invoking lease acquisition until the grant is returned, or acquisition ends; hold runs from that returned grant through the existing release. These observations include client lease bookkeeping rather than a sub-clock claim about the semaphore's internal transition. BEGIN, settlement, rollback and synchronous-level restoration stay within the observed lease; publication and after-commit work stay outside it. Only acknowledged writer statements contribute child elapsed. The completed observation is available before the existing move/publication boundary, so a bench can pair the unit's writer-side COMMIT instant with the delivered frame without moving either acknowledgement.