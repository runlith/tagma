---
id: 01a15ab1-8dbe-7e56-a9db-4548e705ea87
title: A reference to another project block whose id stands in several copies gets an executable address at doors with mention fields
ord: 146
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15a9e-e8f4-7e76-bab5-f651d6c30fe9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15a9e-c55b-78cf-8ee7-8424cc9a50ac
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/references.ts
    symbol: blockAddress
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/crossing.ts
    symbol: findTarget
---
After [[cc9a50ac]] a door's block-subject is chosen by `project`, and `ambiguous-name` over copies names each candidate's project. A secondary reference to a block in another project is not addressed by this: `link_blocks {fromId: <block A>, toId: <id standing in B and in its fork C>}` resolves `toId` (`blockMention`, the `mention` role) through `targeted → locate → findTarget → elsewhere` in A's context and refuses `ambiguous-name`; the `project: B` hint runs into `place-mismatch`, because `fromId` belongs to A, and lengthening the name on one uuid gains nothing. The `update_block.parentId` into another graph and `create_block.edges[].to` meet the same boundary.

What to decide: a way to name the project of a specific reference at the name-resolution owner (`crossing.ts`), not at each door — for example a qualified `project/name` in the `blockMention` grammar — with `ambiguousAcross` offering exactly that where the name is not the call's subject. Take into account: copies of one graph share the root too, so the edge far end's address (`FarAddress`: graph root + uuid) is the same for B and C — for an edge the copy choice changes nothing, only the facts read (title, status).

Proof: a test through the public operation — `link_blocks` from A onto a block standing in B and C refuses with an executable exit without the qualifier, and passes with it.
