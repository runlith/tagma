---
id: 01a102c0-5ed9-783d-9496-cc1702328b95
title: The `modules` builtin treats SvelteKit's `$app/*` virtual modules as framework imports instead of refusing them as unresolved
ord: 16
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f95-99b8-7325-8d9a-d0a769566ef9",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/implementation.ts
  - kind: file
    ref: packages/layer/src/sveltekit/index.ts
---
`packages/layer/src/sveltekit/index.ts` imports `$app/navigation` and `$app/state`, SvelteKit's virtual modules, which no file in the tree defines. The `modules` builtin reports both as `@runlith/layer -> $app/… unresolved`, and they stand as two debt entries of the module-import rule. Their former owner, the closed rule-migration spec cdf2a89f, has ended. An ended owner makes every `set_module` that remeasures the rule refuse `debt-unowned`.

Done when the builtin resolves `$app/*` as an import of the SvelteKit framework — the way it treats a third-party package — with a test that is red before the change, and the two debt entries owned by this task retire. The sibling gap for built workspace packages is 4fe9507f.

The `framework` implementation in the `modules` builtin landed in 47dc1aa6e5606cdc85e306f28c78c6e5b83e8175. The contract test went red→green; inspection typecheck and 25 tests are green. Measuring one snapshot of 4233 files with `framework: ["$app/*"]` removes exactly this task's two violations; the other three and the empty `unjudged` are unchanged. Retirement stays open: the running server silently dropped the new parameter in `enforce_rule` ([[4656ab6f|operation defect]]). After loading the new schema, repeat `enforce_rule` for the [[083d37f1|module rule]], keeping its current parameters and adding `framework: ["$app/*"]`; then close the task with the named commit.
