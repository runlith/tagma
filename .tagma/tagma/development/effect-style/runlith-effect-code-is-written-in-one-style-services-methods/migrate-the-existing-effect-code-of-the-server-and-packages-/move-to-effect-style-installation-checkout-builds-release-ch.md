---
id: 01a13c96-16a0-7cfd-98fb-919e794fbe24
title: "Move to Effect style: installation, checkout-builds, release-channel, landing"
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c96-629f-79f9-a4bc-2d234e722c25",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-builds
  - kind: dir
    ref: apps/tagma/server/src/installation
  - kind: dir
    ref: apps/tagma/server/src/landing
  - kind: dir
    ref: apps/tagma/server/src/release-channel
---
The production code and tests of `installation`, `checkout-builds`, `release-channel` and `landing` in `apps/tagma/server/src` follow the `effect4` skill. Proof is zero effect-style findings for these modules, typecheck and their tests green, spans preserved.
