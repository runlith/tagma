---
id: 01a1aca1-be6e-7ea4-94c4-fe5f8d331079
title: A delegation switch records who made it and when on the thread's mandate, and the notice names the newest decisive switch
ord: 164
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1ac92-4569-7c5f-8043-546eecf34cce
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/mandate.ts
  - kind: file
    ref: apps/tagma/server/src/threads/birth/delegation.ts
---
`set_thread_delegation` is a thread tool as well as the operator's, so the delegation notice cannot assume the operator switched it. Every switch, a clear included, records the signed session that made it (none for the operator's own hand) and its time on the thread's mandate row. The notice names the newest switch in the thread's spawn lineage when a lineage switch decides. When the machine setting decides, it names whichever is newer: that setting's newest row or a lineage switch that was just cleared.
