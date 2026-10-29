---
id: 01a16920-ce52-7433-add7-f4f9371cd107
title: Remeasure forgets the checkout after enforce_rule when the project root is written differently than coverage reports
ord: 76
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1686a-3e84-789c-ba2d-61ca2ed28abd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14128-56ed-7f74-b96f-915450f3baec
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/driver.ts
---
`enforcement/remeasure/driver.ts` compares checkouts by root spelling: `checkoutKey` is the `projectId\0root` string, and the `Start` path drops a checkout when `chosen.root !== checkout.root`. Coverage reports physical roots (`realpath`), while the project root in the graph stands as registration wrote it.

When the project root is written non-physically (on macOS `/tmp/x` versus `/private/tmp/x`, a symlink on the project directory), after every `enforce_rule` `reconcile` removes the checkout from remeasure memory: for it that checkout is "gone". Then `select(…, Start)` rejects it on the physical root for mismatching the graph root. After a server restart the rule isn't remeasured, and that checkout's HEAD isn't watched.

Noticed on `remeasurePrograms.itest.ts`: the demo project there is registered under `/tmp/…` (`graphFixture.ts`, `fixture.directory('demo')` without `realPath`). In prod, git-project registration takes the root from `git rev-parse --git-common-dir`, and it is physical. So by the code the defect only reaches projects whose root is written otherwise: registration before the first commit (`identity.ts` returns the path as given) or a symlink in the path. No prod reproduction checked.

Done when the driver recognizes a checkout by witness ([[b77b7a93]]) rather than spelling: a project registered by a symlink path is remeasured after `enforce_rule` and restart. An itest shows this, with graph root and coverage root written differently.
