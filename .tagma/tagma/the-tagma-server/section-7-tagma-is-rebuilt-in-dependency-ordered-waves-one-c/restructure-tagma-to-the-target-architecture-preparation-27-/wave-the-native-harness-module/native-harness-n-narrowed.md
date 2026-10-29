---
id: 01a0e532-cce0-7967-8be8-7e76471e545e
title: "native-harness N: narrowed"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0eaf6-3d86-775e-aa30-9ed7518e0f02",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-ca7c-7f96-97dd-247ba9fd89de
  - kind: waits-on
    to: 01a0e532-caf3-7065-8c3c-c19e418f681b
  - kind: waits-on
    to: 01a0e532-cc6c-73df-a111-c28429ce4645
  - kind: waits-on
    to: 01a0e532-ccd0-7519-b42c-f1a2fae4395f
  - kind: waits-on
    to: 01a0e532-cd22-7f1c-8fcf-c0b636bb8530
  - kind: waits-on
    to: 01a0e532-cd48-7c09-999e-8e0c98746485
  - kind: waits-on
    to: 01a0e532-cd6e-7a04-85b9-0ab5dd5ad950
  - kind: waits-on
    to: 01a0e532-cd97-7aa9-871a-73f6f2efd51b
  - kind: waits-on
    to: 01a0e532-cf0f-7514-a91c-221fa544b85f
  - kind: waits-on
    to: 01a0e532-cf39-790b-91f0-e6587139e341
---
§7.2.2 milestone `N` of the `native-harness` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

Added by threads N ([[cf4e29b0]], 696cd1d93e): threads now exposes only `contract/` and its composition entries, so native-harness's remaining imports of threads internals (the kernel and journal tables `threads/store/*`, `threads/journal/*`, `threads/list/{wire,summary,warmth,threadList}.ts`, `threads/doctrine/*`, `threads/refusals.ts`, `threads/projectGate.ts`, `threads/mandate.ts`, `threads/library/*`, `threads/birth/*`) are declared as per-file entries `for` native-harness in the threads manifest (about 40 files); native already takes the threads tags (`ThreadLookup` and the other read tags, `ThreadMandate`, `RestedRollouts`, `WorkSpells`, `TargetPreparation`, `ScratchAreas`), and each entry goes as native moves the rest behind ports.