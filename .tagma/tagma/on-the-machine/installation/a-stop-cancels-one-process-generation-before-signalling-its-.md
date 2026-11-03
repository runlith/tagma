---
id: 01a1a262-3fd5-77db-bc2a-8e4c3db4331d
title: A stop cancels one process generation before signalling its members
ord: 77
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/process/chain.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/process.ts
---
A generation's durable stop intent closes admission before its processes are signalled. Successors and automatic returns inherit that generation, so killing a predecessor or the stopping CLI cannot revive a cancelled handover; an explicit new launch creates another generation. Issued predecessors without this protocol cannot prove the fate of an unrecorded automatic return, so stopping them can report an unproven chain rather than claim that Tagma stopped.