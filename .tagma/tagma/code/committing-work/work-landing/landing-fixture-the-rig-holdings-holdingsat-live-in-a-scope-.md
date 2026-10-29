---
id: 01a13cf3-f032-7a97-affc-f5bf834b54aa
title: "Landing fixture: the rig holdings (holdingsAt) live in a scope the fixture owner closes"
ord: 21
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-2ae9-7a08-9bb0-ae79b53cb89b",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c96-16a0-7cfd-98fb-919e794fbe24
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/testing/doubles.ts
---
`landing/testing/doubles.ts` `holdingsAt` holds a WeakMap cache of rigs and opens each in a `Scope.makeUnsafe()` nobody ever closes: judge/retirement finalizers never run. The right shape: `holdingsAt` and `submitOver` take Scope from the calling environment (R = Scope), the cache goes away, and a test gives scope with its own `it.effect`/layer.

The chain runs past landing: `submitOver` is called by `composition/testing/{checkoutFixture,landingFixture,programFixture,landingServices}.ts` and a dozen tests in `composition/testing/landing/*`, `enforcement/*`, `sandbox/importOutput.stest.ts` through `world.runtime.runPromise`, i.e. with no Scope. Their leads are sessions translating change-record and executions; do together with moving those fixtures to `@runlith/effect-test`.

Proof: no rig stays open after a test (judge/retirement finalizers executed); no `Scope.makeUnsafe` in `landing/testing`; typecheck clean.
