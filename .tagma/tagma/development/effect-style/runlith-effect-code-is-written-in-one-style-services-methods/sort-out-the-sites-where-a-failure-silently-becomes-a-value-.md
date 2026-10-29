---
id: 01a13b48-b27e-700f-af59-a2d2498ffdb9
title: "Sort out the sites where a failure silently becomes a value through Effect.result: typed outcome, refusal, or declared best-effort"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13be3-6865-7e09-a84c-a787b52ef743",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13b37-5351-7e3a-bda9-f7c22e414755
---
Found by sampling (88 of ~1100 `Effect.result` sites), the neighbouring task's check will give the full list:
- `apps/tagma/server/src/graph/serving/attach.ts:225` — a tree-read failure answers "blocks present";
- `apps/tagma/server/src/change-record/retire/driver.ts:287` — any git error counts as "no commit";
- `apps/tagma/server/src/change-record/record/commandRows.ts:143` — an unreadable `core.ignorecase` becomes "case-sensitive";
- `apps/tagma/server/src/landing/land/submit.ts:267` — a failed re-judging silently takes the previous judgement;
- `apps/tagma/server/src/landing/merge/publication.ts:299`;
- `apps/tagma/server/src/executions/worlds/managed.ts:89` — an unreadable host status picks the platform world;
- `apps/tagma/server/src/executions/terminals/inventory.ts:331` — a listener-read failure wipes them from cells;
- `packages/agent/src/thread/run/SenderWakes.ts:52`;
- `packages/agent-tools/src/CheckoutBaselines.ts:233`;
- `packages/execution-host/src/registry/operations.ts:86`.

Decide each site by meaning: a typed outcome the caller distinguishes; a typed refusal; or a declared best-effort with the cause in the log. Some sites may be deliberate (a conservative answer) — then it becomes visible in the code and log. Proof is the neighbouring task's check finding no violations here.
