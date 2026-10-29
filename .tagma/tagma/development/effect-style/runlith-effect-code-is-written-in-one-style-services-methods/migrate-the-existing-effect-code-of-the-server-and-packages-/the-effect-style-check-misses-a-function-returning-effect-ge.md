---
id: 01a13cd6-5f3a-705c-97c9-e0b73e3ce2b5
title: The effect-style check misses a function returning Effect.gen(…).pipe(Effect.withSpan(…))
ord: 20
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523f-7ee2-9537-e8014a4925bd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c96-16a0-7cfd-98fb-919f00a0a107
sources:
  - kind: dir
    ref: checks/law/effect-style
---
Rule df923180 requires writing such a function as `Effect.fn('X')(function* …, …)`, but the gen-wrapper shape in `checks/law/effect-style` counts only a bare `Effect.gen` in the body, and a `.pipe(...)` after it passes. Found while migrating the platform tests (55db6456de): `invocation/admission/admit.ts` (`invocation.admit`), `platform/store/snapshotPlan.ts`. Done in `4b539ceee8`: the shape walks the `.pipe` receiver chain, public checker tests cover verdict and fingerprint stability. Measuring with the new shape found +115 sites; on the operator's word the rule's whole standing set — 690 sites — was accepted through enforce_law as debt on the [[449dfe0d|migration wave]], gate kept, escaped 0, enforcement revision `a6fda622a794`. The span name moves into `Effect.fn` unchanged.
