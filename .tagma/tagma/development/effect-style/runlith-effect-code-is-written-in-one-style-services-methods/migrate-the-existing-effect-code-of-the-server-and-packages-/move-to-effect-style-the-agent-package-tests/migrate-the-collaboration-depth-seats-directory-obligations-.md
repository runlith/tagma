---
id: 01a13e17-bf52-7778-a2eb-0cca65396e9f
title: Migrate the collaboration depth, seats, directory, obligations and sources tests to Effect
ord: 11
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/collaboration/collaborationResidency.test.ts
  - kind: file
    ref: packages/agent/src/collaboration/collaborationToolSources.test.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadDirectory.test.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadObligations.test.ts
  - kind: file
    ref: packages/agent/src/collaboration/ThreadSpawnAccess.test.ts
---
Migrate ThreadSpawnAccess, collaborationResidency, ThreadDirectory, ThreadObligations and collaborationToolSources to @runlith/effect-test. Keep depth/lineage refusal, seat release by run identity, next-request warmth and paging, requester obligations and fork-source independence. Full doubles replace partial service casts, prompt-pinning is removed; TestClock pins time. Proof is the group's tests, typecheck, check_law and one review round.
