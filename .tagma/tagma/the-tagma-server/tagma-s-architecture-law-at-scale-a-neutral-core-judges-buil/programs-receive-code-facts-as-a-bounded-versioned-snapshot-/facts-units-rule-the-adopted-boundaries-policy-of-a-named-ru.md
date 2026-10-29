---
id: 01a0f774-7348-729f-83c3-9382134f0e3e
title: "Facts `units:<rule>`: the adopted `boundaries` policy of a named rule reaches the program road, and the snapshot carries each path's unit on both sides"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f746-df34-7e3a-a2b4-b59706a3f794",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/adoption/predecessor.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/facts.itest.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/programs/facts.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/facts.ts
---
Build the open part of delta [[a664322b]] under [[3f3fe425]]. The judging callers (`judging/judge.ts`, `judging/check.ts`, `adoption/runners.ts` through `rules/enforce.ts`) hand `judgeBindings` the accepted law they already read; a program needing `units:<rule>` gets, for every file of each side's snapshot, the unit and floor of that rule's adopted `boundaries` policy, read by the worker from the same trees. A rule that is not in the accepted law, matches ambiguously, or is not a `boundaries` builtin fails the inspection naming why. Acceptance: a contract test where a fixture program reads units of both sides; refusals for an unadopted and a non-`boundaries` rule; claims written; delta and decision closed (Go and Rust named as separate work).