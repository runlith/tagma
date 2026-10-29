---
id: 01a13bae-4620-7f4f-8543-8357d15bf9bb
title: "The effect-style violation fingerprint changes on edits inside the function body: the site counts over the shape's whole node"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13bac-c9d7-7ebe-bd15-57d9a7969cdb",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13bab-c550-7ca2-954a-2be2bab98648
sources:
  - kind: file
    ref: checks/law/effect-style/sites.ts
---
The `effect-style` check (`checks/law/effect-style/sites.ts`) counts the site as the hash of the whole violation node's normalized text. For shapes whose node spans the body — `gen-wrapper` (the whole function), `pipe-after-fn` (the whole `Effect.fn(…)(function* {…}).pipe(…)`), `test-runner` (`Effect.runPromise(Effect.gen(…))`), `schema-tagged-error` (the call with the field schema) — any edit inside the body changes the `${path} ${symbol} ${form} ${site}` fingerprint, and standing debt becomes a "new" violation: the gate refuses an agent who only renamed a field.

To do: each shape's site counts from the narrow fragment that is the violation — nested function bodies dropped, `Schema.TaggedError` fields excluded. A body edit does not change the identity, a shape edit does. Then recount the debt of rules 8fcfef49, df923180, bc8f1e15, 373e29e4, 01ba3d55, d270a238 through `enforce_law` with their own enforcement.

Proof: the contract test in `checks/law/effect-style.test.ts` (a body edit keeps the fingerprint, a shape edit does not), `bun run typecheck`, the `checks/law` tests, enforce_law with no escaped.
