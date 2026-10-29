---
id: 01a13c96-16a0-7cfd-98fb-919f00a0a107
title: "Move to Effect style: the platform, enforcement, invocation, power, artifacts, performance, http, sandbox tests"
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c96-62a0-77c6-a020-f4438dd75853",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/enforcement
  - kind: dir
    ref: apps/tagma/server/src/invocation
  - kind: dir
    ref: apps/tagma/server/src/platform
---
These `apps/tagma/server/src` modules' tests go to `@runlith/effect-test`, together with the remaining production code in `platform` and `enforcement`. Useless tests are deleted under rule 4f387de2. Proof is zero effect-style findings for the modules, tests green.
