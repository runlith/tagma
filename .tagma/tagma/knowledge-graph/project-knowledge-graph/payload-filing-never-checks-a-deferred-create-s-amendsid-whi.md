---
id: 01a0caaf-456c-78af-8a5e-abff9674ea21
title: Payload filing never checks a deferred create's `amendsId`, which then dies at accept
ord: 219
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/proposals/filing.ts
    symbol: proposalFiling
---
`assertAmendment` scope-checks a payload create's `parentId`, `implementsId` and `discoveredFromId`, but never its `amendsId`: a create carrying one passes filing and refuses `amends-shape` only when the payload runs at accept. The file's own comment says a proposal nobody can accept is a review's dead end, refused at filing — this one is filed, then dies at accept.

Done when filing refuses a create whose `amendsId` the accept road would refuse, with the same way out `Blocks.create` gives — proved by a payload test beside the filing cases.