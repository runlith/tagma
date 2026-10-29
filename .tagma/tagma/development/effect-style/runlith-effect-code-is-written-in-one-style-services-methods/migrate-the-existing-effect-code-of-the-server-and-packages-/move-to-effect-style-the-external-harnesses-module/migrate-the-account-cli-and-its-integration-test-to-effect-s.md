---
id: 01a13f59-5bff-7156-86f0-559f05f9c6f4
title: Migrate the account CLI and its integration test to Effect shape
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f16-3817-7139-a4eb-84cd102afa14",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f16-1128-7f09-9a38-ea1d23d2ccf0
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/accounts
---
The `external-harnesses/accounts/` group: shape Effect functions and the AccountCli assembly through closures and Tag.of, move the test to effect-test with a scoped temp directory, and keep headless-child termination on timeout and overflow. Verification is effect-style 0, type checks and two contract process tests, preserved spans, an independent review and numbers before the permitted landing.
