---
id: 01a14bc5-0df5-77c8-b1a2-693ed42057f8
title: Outdated knowledge gains a successor, and a replaced block returns to standing when the replacement was a mistake or the record itself needs fixing
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693cdef49593
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69423f034f23
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/retirement.ts
    symbol: assertStanding
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/supersession.ts
    symbol: supersessionLayer
---
**Value.** Outdated knowledge is neither deleted nor kept beside the new: the old block stays readable history, and live readings lead to the successor. So the graph holds no two competing descriptions of the same thing.

**How.** `supersede_block` and `unsupersede_block`; replacement and return also live in `apply_batch`.

**Behaviour.**
- A replaced block vanishes from search, queries, outline, and zones until history is asked for. It is not rewritten, taken into work, or implemented.
- Replaced work that someone held leaves work. Replacing someone else's work carries the "held by another session" fact.
- The answer names the blocks referencing the replaced one, so links move to the successor.
- A mistaken replacement is withdrawn: the block stands again, but the removed hold does not return.
- The record itself — for example text that must not stay — is fixed the same way: the block is returned, edited, and replaced with the same successor. One `apply_batch` rolls these three steps back together, and the block never stands as current even for a moment. Only the current text is cleaned: earlier versions stay in the graph's git history.

**Limits.** Only a block of the same project replaces, and only onto the chain head. A module never replaces. No separate check exists for settled knowledge: replacement asks the operator in review mode, like any graph record.
