---
id: 01a0e532-cca6-794c-bf22-e42bcf4e29b0
title: "threads N: narrowed"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e5c4-94b9-7fed-bbb0-6060db0ffafa",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c977-7ae5-ba79-c0cedb416adf
  - kind: waits-on
    to: 01a0e532-ca7c-7f96-97dd-247ba9fd89de
  - kind: waits-on
    to: 01a0e532-caf3-7065-8c3c-c19e418f681b
  - kind: waits-on
    to: 01a0e532-cc21-7162-9c3e-d9aee2b6e4ec
  - kind: waits-on
    to: 01a0e532-cc9a-7490-ace7-9cbde4e64d86
  - kind: waits-on
    to: 01a0e532-ccc1-799b-82bd-bde34047bdcd
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
Re-owned from native-harness N ([[471e545e]]): the watch entry `F4 threads/journal/lane.ts` (a threads file), and `S6 native-harness/runs/ledger.ts#ThreadRunStore.markThreadStatus`, whose name is fixed by the kernel port `ThreadRunStorage.markThreadStatus` in `packages/agent/src/thread/storage/runs.ts`: renaming it to `markStatus` is a kernel-port change that goes with the threads cut.

§7.2.2 milestone `N` of the `threads` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].