---
id: 01a17561-43b1-71f4-9811-b8570ba1933d
title: The modules inspection refuses non-literal loads that cannot be judged by cards
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17583-763b-74fd-84bb-4aa8f4659071",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17546-5fbe-758a-97aa-b07233ece7f0
sources:
  - kind: file
    ref: apps/tagma/inspection/src/packs/architecture/modules/implementation.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/origin.ts
---
448efc38e8 routed non-literal `import()`/`require()` and non-relative globs into the `unresolved` policy of the `modules` builtin. runlith defaults to `refuse`, so 14 findings of rule [[083d37f1]] appeared on HEAD. Almost all these loads' paths compute at run time:
- provider adapters from disk and the project's programs;
- the native addon and `require(label)` in the Cursor hook;
- bundles tests assemble in temporary directories;
- Vitest configs and `tagma.config.ts`, which scripts read;
- `import(new URL(...))` in `liveGroup.test.ts` and the from-root Vite glob in `routes.test.ts`.

Module cards cannot judge such a load: the target is unknown before execution. But it must not hide silently either. These 14 fingerprints currently lie in this task's debt.

The `unresolved: 'unjudged'` option hits the same dead end: `escapeOrigins` in `enforcement/remeasure/origin.ts` refuses on any historic version where the inspection left unjudged origins, even when the wanted fingerprint has nothing to do with them. Remeasure falls, and until it passes every landing in the checkout refuses.

**Done.** Origin search no longer refuses on an unjudged place in a file the wanted violation has nothing to do with, when the builtin declares that each of its findings belongs to its own file (`perFile` on `modules`, `fileLocal` on the rest). For `loads`, `names` and programs any unjudged place still refuses: on `loads` a fingerprint is "start × forbidden write", and a place on any path from the start can hide it. Commit c68a910fff.

**Decided by the operator.** A load by a path known only at launch is not a link between modules: `modules` calls it `unjudged` under any policy, and `unresolved` judges only a literal import that hits nothing. A from-root glob (`/src/...`) is judged from the root declared in the `roots` parameter: where the builder root lies (Vite `root`, otherwise the launch directory) is decided by the build, and one tree does not define it; a glob in a file with no declared root is `unjudged`. `modules` declares `hides: 'nothing'`: its uninspected loads never become findings, so origin search never refuses on a place in the violation's file either.

**Done when:**
- a computed-path load is judged or named as the rule's contract requires, with no softening of broken-literal-import catching;
- origin search on a version with unjudged origins behaves per contract for fingerprints they have nothing to do with;
- the fix stands at the owner, with a test through the same door as the real call, red before the fix;
- the 14 debt entries left on their own, because no findings remain.
