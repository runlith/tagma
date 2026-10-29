---
id: 01a1417f-9dbb-7825-ae17-a672d4dfb793
title: "The server exits when owner closing ends, not on a deadline: a stuck finalizer holds the data directory until its end"
ord: 16
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1415a-e83c-72af-8b27-acb829207044
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/server.ts
---
On SIGINT/SIGTERM the server closes its owners (`closed`), releases the data directory, and only then exits; there is no deadline for this. The old deadline (10 s, 29.2 s on restart) killed slow but ongoing closing: on October 15 it cut the process mid `activity closing`, the directory stayed without release, and the successor recorded `unreleased`. On a slow machine closing honestly takes minutes, and any deadline lies there.

Price of the decision: if an owner's finalizer waits for an event that will never come, the process stays alive holding the data directory, and the successor waits for it forever — only release, the predecessor's exit, or IPC loss ends the successor's wait ([[2e4c21a3]]). Which phase is stuck is visible in the restart record: it has `endedAt: null`. Such a finalizer is its owner's defect, fixed there, not by a deadline here.
