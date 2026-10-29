---
id: 01a14564-656e-7e40-9f43-ef3502de86cf
title: "A holding remembers which work it was taken for: HeldFor signs the token and every hold record, holders answers the current holders"
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/held/src/Held.ts
  - kind: file
    ref: packages/held/src/holding.ts
---
The work owner sets `HeldFor` in context, and everything that work takes carries that signature: the holding token and every threshold, cut and wait-ceiling record. `holders` answers the key's live tokens while the holding stands. This is the only way to ask who holds the resource now, not after the holding ends.

Without the signature, a holding stuck for 15 minutes stayed nameless until it ended: the threshold line named the resource but not the work.

Take time runs on monotonic clocks from the holding context. For a resource on physical clocks, a machine sleep does not count toward the holding.
