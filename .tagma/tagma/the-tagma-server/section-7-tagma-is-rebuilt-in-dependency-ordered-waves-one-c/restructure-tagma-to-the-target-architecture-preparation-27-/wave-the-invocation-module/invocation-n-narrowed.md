---
id: 01a0e532-cd5b-72de-a878-3aae158fdaf5
title: "invocation N: narrowed"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e9c3-5234-74ec-b21f-4fd941d87513",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-cd53-7c58-906b-2f6ac60233f6
  - kind: waits-on
    to: 01a0e532-cd6e-7a04-85b9-0ab5dd5ad950
  - kind: waits-on
    to: 01a0e532-cd97-7aa9-871a-73f6f2efd51b
  - kind: waits-on
    to: 01a0e532-cf0f-7514-a91c-221fa544b85f
  - kind: waits-on
    to: 01a0e532-cf39-790b-91f0-e6587139e341
---
Added by native-harness N ([[471e545e]], 25396042ad): `invocation/nativeDoor.ts` and `invocation/admission/identity.ts` import native-harness internals (`ThreadContext`, tool words, execution) that native-harness no longer exposes; they stand as `invocation -> native-harness private` debt owned here and leave when the door takes `ThreadExecution` and the tools from the contract.

§7.2.2 milestone `N` of the `invocation` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

Re-owned from native-harness M3 ([[fae4395f]], afd5b80237): `native-harness → performance` and `→ landing` in `contract/wire/toolResult.ts` and `voice/graphTools.ts` leaves when `nativeDoor` renders an operation's answer through its owner's body `voice`, so the graph-tool voice stops switching over landing's and performance's answers.