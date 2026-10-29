---
id: 01a13d2f-397e-77cc-90c3-6f0408aa72d5
title: "Move to Effect style: the graph module tests"
ord: 25
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13d2f-a3f4-7833-9183-21ba84bb0f8a",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/graph
  - kind: dir
    ref: apps/tagma/server/src/graph
---
The `apps/tagma/server/src/graph/**` and `apps/tagma/server/src/composition/testing/graph/**` tests go to `@runlith/effect-test`; useless ones are deleted under rule 4f387de2. The graph production code is already migrated (64ef0ba3). Proof is zero effect-style findings for these tests, tests green.
