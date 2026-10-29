---
id: 01a1273c-99cc-734f-a6ae-b0ec1c4982b8
title: "Landing in the place's checkout: submit_work commits to a foreign checkout under its gates, commit steps, and tasks"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12792-377a-74d7-a5cf-973224705d2b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
  - kind: waits-on
    to: 01a12726-9e16-7f6a-a8a2-152f37d7c9ad
  - kind: waits-on
    to: 01a12726-9e16-7f6a-a8a2-1531ada88e6f
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/selection.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/landing/place.stest.ts
  - kind: file
    ref: apps/tagma/server/src/landing/operations/submit.ts
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/remeasure/rule.ts
    symbol: remeasureRule
---
The spec's "Landing" section. Rests on the place contract [[37d7c9ad|place contract]] (`CallPlace`, `Place`, `place: true`) and on line accounting [[ada88e6f|line accounting]] (`holderProjectId`, `placeAcross`).

Do: `submit_work` takes an explicit place; without one, the single checkout where the session holds lines; lines in two checkouts (even of one project) refuse, telling the caller to split. The commit goes to the place's checkout; the place's enforced rules judge, commit steps come from the place's `tagma.config.ts`, thread tasks are the session's tasks from the place's graph; `paths` is a relative filter inside the chosen checkout. `taking` and the operator's and other sessions' lines work as in one's own checkout. An escaped-violation notice (`rule-escaped`, `remeasure/rule.ts` `escapeNotices`) is addressed to the line holder's home, not the place's project.

Proven: `landing/place.stest.ts` — 29 assertions in 12.63 s: B's gate and `check_rules`, B's form and task, peer/operator line preservation, two checkouts, mismatch, the worktree's own law and a repeated main gate, `taking`. `selection.itest.ts` — 10 assertions: current holdings, explicit project from a worktree, an ignored path; the first `enforcement/remeasure.itest.ts` scenario — delivery to a foreign home; the `executions/commandAccess.itest.ts` scenario — B's policy under a private tree's physical cwd with A's custody; three earlier `landing/submit.itest.ts` scenarios passed. Narrow typecheck of all changed owners and consumers passed; the full suite was not run. Sol xhigh, Opus high, and two Muse xhigh lenses read the delivery; confirmed findings were fixed, including the missed `PrepareInput` production consumer and the `policyRoot` commit step. The full execution-host wire and a live server are unproven with this set; the working server was not restarted. Code: `a2925b71c8`.
