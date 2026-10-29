---
id: 01a13f5c-08a6-7439-8014-97f68648d1af
title: Migrate the inbox and run context switching to scoped Effect
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/conformance/runCycle/eventLog.ts
  - kind: file
    ref: packages/agent/src/thread/conformance/runCycle/inbox.ts
  - kind: file
    ref: packages/agent/src/thread/conformance/runCycle/runWorld.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunContexts.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunInbox.test.ts
---
Migrate ThreadRunInbox.test.ts and ThreadRunContexts.test.ts to @runlith/effect-test. Keep acceptance ordering, cohorts, duplicates, durable input on owner loss; idempotent generation switching, fencing, denial, commit in the publication unit and evidence recovery. Replace promise gates with Deferred and full doubles under their own tags; move the shared full journal and managed inbox into conformance/runCycle, use the existing runWorld with the same journal. Remove forwarding and duplicate assertions with an explicit account, weaken no other contracts. Proof is these files' and the touched runWorld consumers' tests, package-only typecheck, check_law, one review and metrics. The remaining RunExecution/RunLifecycle/ThreadRunReaper stay in the parent task.
