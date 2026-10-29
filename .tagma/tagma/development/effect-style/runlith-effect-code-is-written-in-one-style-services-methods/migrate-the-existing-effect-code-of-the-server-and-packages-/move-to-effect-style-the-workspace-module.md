---
id: 01a13bff-3449-7e83-b959-de5aea4edbe3
title: "Move to Effect style: the workspace module"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13bff-4873-7c30-b372-6b8f408d007f",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/workspace
---
Scope: `apps/tagma/server/src/workspace/` — production code and tests (effect-style measurement 2026-10-14: 82 code sites, 90 in tests). Proof is zero effect-style findings for the module, module typecheck and tests green, spans preserved.

**Result (387a264, 118ba55).** effect-style 0. Typecheck clean. Module and consumer itests green. check_law with no violations.

**Unproven:**
- `composition/testing/cli/nativeSignature.itest.ts` exceeds the budget: 10.8 s CPU standalone at an 8 s threshold. The excess predates this work.
- `workspace/watch/shared.itest.ts` fails at load ~10 on the 10 s timeout. The failing ones are "every follower…" and the HEAD observer, and the HEAD observer does not call shared.ts code. At load ~5 and in a standalone run the test is green.
- For three ea465bed sites the inspection left unjudged:
  - reads.ts `placeOf`;
  - coverage.ts `survey`;
  - registry.ts `removed`.
