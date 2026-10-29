---
id: 01a0c96e-bbd9-7c23-8063-5c01ef42cd77
title: "Landing a session's work fences no runs: holdLanding has no landing caller, and a run opening mid-commit is signed under the wrong session"
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d09a-48a0-7f12-b48e-1002800f2444",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/harness/submitWork.ts
  - kind: file
    ref: apps/tagma/server/src/harness/WorkspaceChangeLog.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/runAdmission.ts
    symbol: holdLanding
---
The run machine offers `holdLanding`: while a thread's admission is held in this process, no run of that thread opens. Its purpose, as the admission module's own words have it, is that an act landing a session's work can stop new runs from writing under it for the span of the landing.

No landing act uses it. The only production caller of the primitive is a guest-import stillness read, which holds admission for a different and correct reason. `apps/tagma/server/src/harness/submitWork.ts` — the act that actually lands work — never calls it, and `apps/tagma/server/src/harness/WorkspaceChangeLog.ts` imports the function and never calls it either.

What that leaves open is a real race, not a tidiness problem. `submitWork` reads which sessions hold which paths, weighs them, and then stages and commits under a per-root semaphore that gates only the staging and the commit. A run opening between the holdings read and the staging writes its bytes into files the commit is about to take, and those bytes are signed under the submitting session rather than the one that wrote them; the shared-holder read that names other writers in the answer runs before that run existed, so the commit does not name it either. The change record is what attributes every line in this product, so a line attributed to the wrong session is the kind of wrong that is not visible afterwards.

Two candidate resolutions, and the choice is a product one. Hold the submitting session's admission across `submitWork`'s whole weigh-to-commit span, which closes the race and makes the primitive's stated purpose true. Or accept that landing does not fence runs, delete the dead import, and narrow the admission module's own words to the read-hold use that exists — which leaves the race open and says so.

Done when `holdLanding` has either a landing caller or no landing story, no import stands uncalled, and the claim over the admission gate matches whichever was chosen.
