---
id: 01a196fb-0b48-78bf-b865-846fad128298
title: Graph pages retain exact block identity across tree updates and restore
ord: 18
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19595-3043-740f-9cf7-9474573600a0",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a196db-341a-7c0a-9804-2f599f4ffa55
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/ProjectTree.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/TreeScreen.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/Subject.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/BlockPage.svelte
---
A full-UUID source address reads the correct restored block, but TreeScreen also uses that requested address as a ProjectTree key while read/tree rows carry short names, leaving the page waiting and its tree/mutations without a matching root. Determine and implement the smallest owner-level distinction between an exact requested address and the resolved row/tree identity. Preserve exactness under real local and foreign suffix collisions, restoration, parent/child membership, mutations and live updates; identity facts belong to their graph/tree producer, not a suffix converter or page normalizer. Keep ordinary short-address behavior, Subject's request lifetime and the live-root invariant. Include any necessary wire and consumer changes as one coherent contract, without assuming a global name-format migration. Prove the actual full-address trash-to-restored page and colliding rows through the affected public paths; run affected checks and one independent review after author checks.