---
id: 01a13be8-c38c-7f61-871f-39a61f6528e0
title: "Move to Effect style: the sandbox module"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13be9-049e-739b-adf8-1516571cb206",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/sandbox
---
A trial migration wave. Scope: `apps/tagma/server/src/sandbox/` — production code and tests (measurement 2026-10-14: 59 code sites, 10 in tests). Proof is zero effect-style findings for the module, module typecheck and tests green, spans preserved.

Delivery: effect-style 69 → 0; check_law with no violations; 32 sandbox tests including Docker proxy and 29 composition tests green. After the review, the scoped cleanup of the helper process and releasing only one's own copy on failure/interruption were verified. The eternal PreparedTrees.acquire counter leak on registry refusal was fixed; the previous 21 spans kept. Effect4 gained the synchronous closure-factory condition with no resource or tag acquired at creation. The full typecheck read 4696 files: no sandbox errors, the overall result is 301 errors in 20 files of the unfinished worktrees migration and its composition consumers; overall green typing unproven.
