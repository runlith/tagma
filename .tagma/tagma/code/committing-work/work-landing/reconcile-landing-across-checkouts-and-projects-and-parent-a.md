---
id: 01a12d37-cd9e-76cf-a5b7-583f49aea641
title: Reconcile landing across checkouts and projects, and parent answers to approvals
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c8a-a6f5-7ca4-8351-a0667bda6f35",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a10bed-7103-78b2-be14-f0bac626af38
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/http/approver.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/landing/place.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/place.stest.ts
---
Check four reflections about the landing place, a foreign project's task write, and a parent's answer to a native child's approval against current code and public contracts. Where behavior is already fixed, answer with its owner's commit; fix a found defect at the root with red→green and an independent review. Start from the landing place selection, change-record intake, the graph selector and approvers. Fixed: the remembered checkout mixed with explicit cwd, and a lost by/note of a parent refusal; checkout selection is now shared for submit_work and check_rules over change at the change record. Public red→green cases proved main after worktree, explicit project/checkout and taking; 11 targeted tests green; the first bun check passed 4450 files, the last after moving CallerAim into platform names only four foreign errors in providers/adapters/instanceActs.ts and providers/operations.ts. One Sol review and two Muse lenses confirmed the leftovers and provenance. The approver test moved to the system layer after 8289 ms CPU. Updating the working install is the operator's step.
