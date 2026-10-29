---
id: 01a13b37-5351-7e3a-bda9-f7c1ad96c517
title: Own it.effect, it.live and layer for bun:test matching the @effect/vitest contract, and a pilot on one module's tests
ord: 2
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
Own `it.effect` for `bun:test`: the same contract as `@effect/vitest`, without Vitest.

New package (working name `packages/effect-test`): `it.effect` (Scope closes after the test, `TestClock` and `TestConsole` by default), `it.live` (real time), `layer(…)` (the layer builds once per group and tears down after it), `it.effect.each`. The behaviour reference is `@effect/vitest` in `.external/effect` at tag `effect@4.0.1`. Runs over `bun:test` and `effect/testing`; assertions are `expect` from `bun:test`.

Pilot: one module's tests (`apps/tagma/server/src/worktrees/`: 6 unit and 11 integration files) are rewritten onto the package. Proof of completion: the package's and the module's tests are green, the pilot is visibly shorter than before, review under the model-choice rule.
