---
id: 01a13b37-5351-7e3a-bda9-f7c0cb27ea54
title: "Experiment: a stateful service is written as a class with Effect.fn({ self }) fields or as closures in make"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13ad9-62d0-709e-8021-29b44a8e3ed8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
---
Decide how a stateful service with dependencies is written: class or closures.

An experiment in a separate scratch worktree, never merged into main. 2–3 real services of different sizes (small — `apps/tagma/server/src/remote/reach.ts`; medium; large with a wide constructor) are rewritten in two variants:
- A: a class, methods as `Effect.fn('X.m')({ self: this }, function* … )` fields (probe 2026-10-14: passes `bun check`, works even when called detached from the object);
- B: the Effect 4 canon — closures in `make`, `X.of({...})`, a `Layer.effect` layer.

Compare: size and readability, how test doubles are built, the 650-line file limit and splitting a large service, private helpers, call cost. Proof of completion is both variants per service compiling and passing the module tests, plus a recorded finding with a recommendation.
