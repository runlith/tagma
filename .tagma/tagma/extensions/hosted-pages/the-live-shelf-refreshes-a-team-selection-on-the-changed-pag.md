---
id: 01a1514e-56e0-768b-804d-b1780929e6f9
title: The live shelf refreshes a team selection on the changed page and shares it between subscribers
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1515e-4517-778a-bf5d-449e7edc0b93",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15134-0b9f-7e2c-809e-ec1a0f5e8829
sources:
  - kind: file
    ref: apps/tagma/server/src/artifacts/shelf.ts
  - kind: file
    ref: apps/tagma/server/src/artifacts/storage.ts
---
The shelf owner maintains an incremental projection of the live selection: the same thread order and limit share one initial frame and subsequent answers, the last subscription frees the projection in the worker. A publication refreshes only the changed page with the ready record; the exact total, top-k, the first-requested owner of a shared page, and the previous order at equal times are kept. A shared page refreshes on publication outside the team too. An unhandled storage failure terminates the worker and subscriptions, because the publication may have partly changed current; a new subscription restores from files. Scope closing covers already open and still opening subscriptions.

16 shelf integration tests and 8 order unit tests verified. Public follow regression first got total 1 instead of 2 after temporarily moving an unchanged page's directory; after the change the second reader and later publications use the shared projection, and a new subscription after the last release re-reads storage. One [[01a15169-802b-7fbf-aa37-30255eeac873|independent review of the whole delivery]] found two P2s: late initial-follow registration after owner closing, and a stale projection after partial publish. Both reproduced before fixing and covered by green public tests. Law inspections and git diff --check pass.

The last bun run typecheck after the review fixes exited 1: a single TS2339 in someone else's apps/tagma/server/src/enforcement/remeasure/rule.ts:344,82, Property 'coverage' does not exist on type. Shelf files got no diagnostics; the previous full pass before the review fixes was green. The working server never restarted. Installed-process costs and lags unmeasured; the improvement is proven by the owner structure and no re-reading in public follow, not by a runtime benchmark.
