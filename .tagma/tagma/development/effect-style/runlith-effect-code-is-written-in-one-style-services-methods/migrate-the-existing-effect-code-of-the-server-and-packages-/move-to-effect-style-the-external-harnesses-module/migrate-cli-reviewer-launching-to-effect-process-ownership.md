---
id: 01a13f75-214e-76ca-83ea-e87762580f37
title: Migrate CLI reviewer launching to Effect process ownership
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f16-3817-7139-a4eb-84cd102afa14",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f16-1128-7f09-9a38-ea1d23d2ccf0
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses/review
---
The `external-harnesses/review/` group is already syntactically free of effect-style findings, but `spawnReview` in `launch.ts` spawns a Bun child and awaits a Promise with no release owner: on effect interruption the child process's termination and reap are undeclared. Migrate the IO step to a named Effect.fn with a scoped process owner, keep the log and exit answers; cap simultaneous reviewer processes at three instead of unbounded. Start from the public runReviews and the CLI consumer; prove cancellation and reap with a contract test, keep the previous argv shape, then typecheck, check_law and one review round.
