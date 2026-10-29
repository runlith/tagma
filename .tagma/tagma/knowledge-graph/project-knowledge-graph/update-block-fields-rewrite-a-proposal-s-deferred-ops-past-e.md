---
id: 01a0caad-f613-74f7-a576-a0407d43b0ee
title: "`update_block` fields rewrite a proposal's deferred ops past every `revise` gate, decided proposals included"
ord: 145
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/update.ts
    symbol: blockUpdate
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/proposals/filing.ts
    symbol: proposalFiling
---
`update_block` with `fields` rewrites a proposal's deferred `ops` like any other field: it runs the superseded-only retirement gate, the operated-field gate and the field validators — none of which refuses an `ops` rewrite on an open or a decided proposal. The `revise` road's three gates — terminality (`verdict-standing`), payload scope and payload caps — are all bypassed, and the write is recorded as an `update` rather than a `revise`. The comment above the fields write says the retirement gate and the verdict forbid it; neither does.

Done when an `ops` rewrite through `update_block` refuses with the way out (`revise` for an open proposal, a derived proposal for a decided one) — proved by a test beside `Review.test.ts`'s revise cases — and claims [[be5a2599]] and [[2d6783bb]] are re-read against the fixed gates.