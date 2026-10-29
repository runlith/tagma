---
id: 01a0c83d-bf2e-71c8-a729-d00a006df37c
title: Build the zone for memory readings and captures
ord: 95
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/performance/src/MemoryCaptures.ts
  - kind: file
    ref: packages/performance/src/MemoryReading.ts
---
Wave 1, builder: [[61780bc4]] of [[2a74de70]] — `src/MemoryReading.ts` (92), `src/MemoryCaptures.ts` (112). Read both whole.

Leads: the three places the reading accounts bytes in, and why the allocator half is the half nothing else answers; the allocator statistics checked for shape before they are believed, and absent standing for unread rather than empty; the thread a reading names and the bound on how many object types it carries; the collection taken before a capture and what the pause figure measures; a capture refused because the queue or the store would not keep it.

This reading is also taken by the store's worker and by the memory report; those callers are [[d4b6f6d5]]'s and [[1f61148e]]'s, and the growth arithmetic over two captures is [[1f61148e]]'s.

Done when the claims stand verified, `run_doctor` over both files is clean and the review passes.