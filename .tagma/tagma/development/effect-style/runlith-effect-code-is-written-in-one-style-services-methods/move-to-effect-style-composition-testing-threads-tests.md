---
id: 01a1487f-0761-743a-89fe-98e48f3e8091
title: "Move to Effect style: composition/testing/threads tests"
ord: 13
tags: ["task"]
fields:
  {
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/composition/testing/threads
---
The tests in `apps/tagma/server/src/composition/testing/threads` run effects through `Effect.runPromise`/`runSync` and a shared per-file runtime, against rule d270a238. No migration task covers them: 3c961b0c is the `threads` module, d1cc7192 is http, cli and the composition/testing root. The rolloutDrill dependence on substituting the closed pool was removed in [[6db88451|a separate task]]; the directory's full migration is not done here yet. Moving the files to `@runlith/effect-test` with a world per test removes both the style and the order dependence. Done when effect-style for the directory is 0 and the tests are green.
