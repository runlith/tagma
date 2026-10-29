---
id: 01a17fe1-cf69-79bd-a693-689fa3f14c1d
title: "`create_block` and `update_block` write a proposal's ops field past the filing gates: references and subtree bounds are judged only on acceptance"
ord: 125
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17fc8-0671-75ed-a96c-0dcde5588d5c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17fcf-ad84-77c3-9b82-ad28b7937e87
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/proposals/filing.ts
    symbol: proposalFiling
---
Proposal-filing gates — ops references, subtree bounds, ops shape — stand in `Review.propose` and `Review.revise` (`graph/work/proposals/filing.ts`, `assertAmendment`). But `create_block` with a `core/amendment`-supporting type goes straight to `Blocks.create` (`graph/operations/blocks.ts`): birth checks only for `amendsId`. And `update_block` rewrites the ops field because `revise_amendment` does not declare it as its slot (`work/proposals/amendmentBehaviour.ts`).

So such proposals are checked only at `accept_amendment`: `verdicts.ts` repeats `assertAmendment`. The `create_block` grammar promises that ops are bounded by the subtree. Addresses in deferred bodies are already judged when the ops field is written ([[b7937e87]]). The other filing gates are not.

Decide who owns writing ops: route amendment-type birth through filing, or raise the filing gates to field writing without calling Review from Blocks.
