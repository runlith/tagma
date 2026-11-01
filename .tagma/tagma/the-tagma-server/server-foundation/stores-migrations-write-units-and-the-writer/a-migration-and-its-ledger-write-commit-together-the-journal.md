---
id: 01a116e8-e326-79fc-a543-6a4b2a177fc9
title: A migration and its ledger write commit together; the journal body shape belongs to the shape steps
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/chain.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/open.ts
---
A ledger separates an applied migration from an attempt: its SQL and its application record commit together, so a refusal never leaves a schema declared half-ready. At open the store knows schema SQL migrations; journal body shape is changed by the owners' shape steps when decoding and when touching one thread. A one-off translation onto the base changes only the ledger, while the snapshot naming folded migrations is taken after commit; a reopened open finishes that taking, preserving the ordinary tail's snapshot.
