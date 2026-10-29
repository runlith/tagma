---
id: 01a0e532-cd85-7552-b192-a87cc294eb1d
title: "http N: narrowed"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-ca7c-7f96-97dd-247ba9fd89de
  - kind: waits-on
    to: 01a0e532-cac4-7f8e-8f52-7d4845779ef0
  - kind: waits-on
    to: 01a0e532-cb66-7fd1-80de-356d51bb3063
  - kind: waits-on
    to: 01a0e532-cb8a-7bef-9a85-b3ffc595c5f9
  - kind: waits-on
    to: 01a0e532-cd7b-73a4-b334-e45a242596cd
  - kind: waits-on
    to: 01a0e532-cd97-7aa9-871a-73f6f2efd51b
  - kind: waits-on
    to: 01a0e532-cf0f-7514-a91c-221fa544b85f
  - kind: waits-on
    to: 01a0e532-cf39-790b-91f0-e6587139e341
---
§7.2.2 milestone `N` of the `http` card ([[f7e0b9dd]]), with its vocabulary amendment [[aa1b0681]].

Carried from M2 [[dd5ad950]]: 206 `modules` and 99 `names` debt entries now owned here — http's imports of the modules whose routes it still serves, which retire as those owners convert their routes (their debt lines stand on [[29ce4645]], [[4047bdcd]], [[36bb8530]], [[191594cc]], [[11f1e38f]]) and as http's relations in the `modules` rule are declared at the merge, and the F6/F7 folder and S-rule names of `api/` and `http/handlers/`, which retire with the typed groups. The two swallowed-failures sites stand as exact allowances since 0644c007c3.