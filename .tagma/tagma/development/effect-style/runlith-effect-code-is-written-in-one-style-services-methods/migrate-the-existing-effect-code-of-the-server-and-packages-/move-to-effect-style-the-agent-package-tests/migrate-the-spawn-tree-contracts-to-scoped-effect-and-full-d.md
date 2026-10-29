---
id: 01a14026-0aeb-740b-88a9-8b3b4aaef7f6
title: Migrate the spawn tree contracts to scoped Effect and full doubles
ord: 29
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
    ref: packages/agent/src/collaboration/ThreadSpawnTree.test.ts
---
Migrate ThreadSpawnTree.test.ts to it.effect: remove ManagedRuntime and partial casts in the local world, return Effect with the test scope and full tagged doubles. Keep the home project's public results/typed refusals, addressing, agreements, rewind, forks and delegation; replace copy checks of refusals with typed conditions, leave synchronous childReachesPeers sync. Touch neither production, scriptedWorld nor a01ffa22. Proof: serial test, scoped typecheck, law, one Sol+Muse review and the landed diff.
