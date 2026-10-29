---
id: 01a15054-b78e-7cd8-9bf3-8940b079dd04
title: Restore server, app, and core typecheck after contract changes
ord: 137
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15054-298e-709a-a8e6-7971bfd3f52b",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/ThreadSlot.svelte.test.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/commitChecks.stest.ts
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/openings.ts
---
Find via git history the causes of the CommitFixture, ThreadProductEntry, capabilities, and CheckoutFrontier errors, reconcile consumers with what producers intended, and do not touch live sessions' uncommitted lines. Proof: typecheck of the server, app, and agent, the affected tests in their layers, one independent review of the whole delivery, and a commit through submit_work.
