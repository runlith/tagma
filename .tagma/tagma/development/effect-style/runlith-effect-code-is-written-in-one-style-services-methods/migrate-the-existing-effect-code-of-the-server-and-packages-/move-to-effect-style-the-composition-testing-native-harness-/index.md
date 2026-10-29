---
id: 01a13f2d-638d-74e9-8a14-33ab8c71aa1b
title: "Move to Effect style: the composition/testing/native-harness tests"
ord: 36
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523d-71cd-acb6-4295df9398b1",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/native-harness
---
The `apps/tagma/server/src/composition/testing/native-harness` tests (about 210 old-runner sites in 27 files as of 2026-10-15) go to `@runlith/effect-test`; useless ones are deleted under rule 4f387de2. Proof is zero effect-style findings for the directory, tests green.
