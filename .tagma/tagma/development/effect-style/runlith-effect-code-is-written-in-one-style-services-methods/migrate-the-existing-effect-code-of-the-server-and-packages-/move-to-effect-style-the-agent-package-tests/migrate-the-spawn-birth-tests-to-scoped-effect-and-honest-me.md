---
id: 01a14033-ea28-79ef-a3fa-7d6138a278e2
title: Migrate the spawn birth tests to scoped Effect and honest memory ports
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/collaboration/ThreadSpawnBirth.test.ts
---
Migrate ThreadSpawnBirth.test.ts wholesale: the local world returns Effect, it.effect holds the lifetime; memory rows/inbox/transitions and full tags replace partial casts. Keep host admission/fork/parent-question gates, atomic race/replay, readiness retry, birth run+step, type/profile/model defaults and switches. Verify refusals by typed condition, concurrent answers as results; Deferred/Scope instead of unsafe runners/Promise lifecycle. Touch neither production, the shared scriptedWorld/storagePort nor a01ffa22. Serial file test, scoped typecheck, law, one Sol+Muse review; diff/evidence to the parent before landing.
