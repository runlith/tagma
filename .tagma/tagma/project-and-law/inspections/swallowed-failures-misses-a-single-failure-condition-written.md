---
id: 01a13ce8-dd7c-7870-b309-8cdc5a61c757
title: swallowed-failures misses a single failure condition written with &&
ord: 28
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13c96-169d-7590-9735-bcaf64ef0ba3
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/effect/swallowed-failures/result.ts
---
The `swallowed-failures` check (`apps/tagma/inspection/src/packs/effect/swallowed-failures/result.ts`, `specificSide`) misses a condition composed with `&&`: the branch `if (r.failure._tag === 'GateRefusal' && r.failure.code === 'no-root') return null; return yield* r.failure;` is judged as `failureReturn`, though it handles one failure condition and re-raises the rest. The same two comparisons in nested `if`s pass. Code is forced to write nested `if`s for the check (as done in `graph/serving/removal.ts` `liveKnowledge`).

To do: in `specificSide` for a `LogicalExpression` with `&&`, count the consequent side as specific when at least one part is specific (for `||` — only when both are); a test in the check's suite for this shape. Done when the `&&` shape passes and `removal.ts` can go back to one `if`.
