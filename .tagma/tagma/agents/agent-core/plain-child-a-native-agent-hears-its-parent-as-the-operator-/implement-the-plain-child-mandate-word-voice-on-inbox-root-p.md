---
id: 01a146bd-7beb-7230-a4ba-8859b42c803d
title: "Implement the plain child: mandate, word voice on inbox, root prompt, approval condition"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a146b3-c880-7fed-abd5-9d213e84a8c9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a146bd-69c8-71fa-bb83-96996cfb2a0f
---
Per spec [[6cfb2a0f]]. Done when: typecheck of `packages/agent` and `apps/tagma/server` is clean, the plain-child itest in `requestObligation.itest.ts` is green, a live `spawn_agent` with `plain: true` on its own `tagma:try` shows the task verbatim and a report to the parent, the review (Sol xhigh + a second one) is worked through, the change is landed.

Not proven: a live run on `tagma:try` — the trial instance has no model subscription accounts (`No stored subscription credential for openai-oauth`), so the parent never made a step. The migration and the `plain` field on the wire are verified there.
