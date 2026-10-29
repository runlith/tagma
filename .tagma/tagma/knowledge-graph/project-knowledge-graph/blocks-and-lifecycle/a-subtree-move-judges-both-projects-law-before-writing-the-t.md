---
id: 01a1794c-172c-7731-9aab-3ed9db8fa24f
title: "A subtree move judges both projects' law before writing: the target's inspection key, debt with its owner, module maps; debt measurement stays with the remeasure"
ord: 14
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1410d-c9d2-795d-a7f8-9eabc82c927b
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/rules/projectLaw.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/service/law.ts
---
The subtree carries the enforcement document, delivery, enabled flag, and module cards as is. Both projects' law changes with the move, and the move does not bypass the gates guarding it in `enforce_rule` and `set_module`. The graph does not read `tagma.config.ts` or know inspections, so it reads project law through its `ProjectLaw` port, which fills enforcement with the same functions that judge landings.

- **Whose vocabulary.** The target's vocabulary decides which moved blocks stand as running rules and module cards there: one tag key in two projects may bind different contracts. What leaves the source map is decided by the source vocabulary.
- **Inspection key.** A running rule (watch or gate) must find its key in the target's `tagma.config.ts` at the HEAD checkout. Without the key the rule becomes unmeasurable, and on gate every target landing would fail with `inspection-failed`. This is the same judgment as `inspection-unknown` at `enforce_rule`. Project law is read only when it holds running rules: a project with none, including one without git, has nothing to judge with.
- **Debt and owner in one graph.** Enforcement counts an owner from another project as not standing (`ownerNamed`), so a move separating a rule from its live debt owner would silently orphan the records. Such a move refuses; an owner that no longer exists holds nothing. A document that does not read refuses too: it cannot prove the debt was not separated.
- **Module edges across the boundary are removed.** The module map belongs to the project, and `set_module` writes `imports` only as ordinary edges: an address edge could never be removed by any operation. The answer names the removed edges. Names in `entries.for` are not removed — an empty list would open entry to everyone — and a source or target map where they no longer find a module refuses.
- **Both projects' maps.** The source map is judged before the write by the cards the departure leaves, and again inside the departure act. The target map — inside the arrival act on the true rows. Running rules taking the map count. A rule whose map did not hold before the move does not block it.
- **Debt measurement stays with the remeasure.** The move starts no inspections: that would put git and workers of two checkouts inside a graph write. The target's background remeasure measures the debt the same way a graph-merge rule does: when its copy opens or its observed copy's HEAD moves. It extinguishes records the target code no longer has and writes violations outside the debt.
