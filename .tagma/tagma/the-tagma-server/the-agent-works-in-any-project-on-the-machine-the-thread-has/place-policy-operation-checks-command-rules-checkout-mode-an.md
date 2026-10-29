---
id: 01a1273c-99cc-734f-a6ae-b0edd1e7ac82
title: "Place policy: operation checks, command rules, checkout mode, and comment policy take the act's place, not the thread's home"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1273c-ae33-73ff-9be5-db3aa2bd59c7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
  - kind: relates
    to: 01a12726-9e16-7f6a-a8a2-152f37d7c9ad
---
The spec's "Place policy" section. Rests on the place contract [[37d7c9ad|place contract]].

Do: consumers that currently take the home get the act's place: `enforcement/operationChecks.ts` (a file outside `workingRoot` is currently skipped, head is taken by `actor.projectId`), after-edit, command rules and command timing (`executions/commands/times.ts`), checkout mode and comment policy of runtime tools (`native-harness/capabilities/worldTools.ts` — they are created separately from `nativeDoor`; their path's/`workdir`'s place is `CheckoutPaths.placeAcross`), git admission. `actor` and authority stay thread-scoped.

Done: integration test on A and B with different command rule and comment policy — a command with `workdir` in B runs under B's rule; a write to a B file is judged by B's policy.
