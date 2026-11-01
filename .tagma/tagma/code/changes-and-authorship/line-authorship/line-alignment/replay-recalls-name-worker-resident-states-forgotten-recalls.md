---
id: 01a194ac-a220-7413-89d4-71f4f1332ae7
title: Replay recalls name worker-resident states; forgotten recalls require full inputs
ord: 12
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a19487-1565-7388-9082-e7b9e6850f6b
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/residence.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/walks.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/walk.worker.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/lines/memory.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/inputs.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/holdings/restore.ts
---
Fold snapshots contain identity-sensitive ropes and lazy line views, so they stay with their bounded worker owner rather than crossing into the serving process. A client keeps only version identities and an opaque recall; the worker's revision prevents an older recall from silently reading a replacement state. Affinity routes a valid recall back to its worker, while an evicted state or lost worker takes the existing alignment fallback through full inputs: partial input must never be replayed as independent history. Text sides, hunk text and compact verdict columns have shared backing; packing and rollback run with projection before an answer leaves that owner. Rollback returns replacement text and the verdict, never its internal fold graph. The replay allowance is split between worker state and client recall metadata, and the worker share is divided by pool capacity, so starting more workers cannot multiply retained state.