---
id: 01a13d30-d804-7b33-9b8b-12527b27377d
title: "Move to Effect style: the agent package tests"
ord: 27
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c17-b1ec-77e1-b49d-4fb1178ad9cf",
    "status": "done"
  }
edges:
  - kind: waits-on
    to: 01a13d2f-397e-77cc-90c3-6f023cd163f7
sources:
  - kind: dir
    ref: packages/agent
---
The `packages/agent` tests (about 825 test-runner sites in 86 files as of 2026-10-15) go to `@runlith/effect-test`; useless ones are deleted under rule 4f387de2. Starts after the package's production code (3cd163f7). Proof is zero effect-style findings for the package tests, tests green.
